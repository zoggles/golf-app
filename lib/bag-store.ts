"use client";

import type { Bag } from "./bag";
import { DEFAULT_BAG, isNewerBag, normalizeBag } from "./bag";
import { apiUrl } from "./api-url";
import { authHeaders } from "./auth-client";
import { readSelectedGolfer, subscribeToSelectedGolfer } from "./golfer-session";

/**
 * Club distances, per golfer.
 *
 * This device's copy is the one everything reads, so Caddy View and range logging work with
 * no signal. Every change is then copied to the golfer's account, and every launch pulls
 * the account's copy, so a bag set up at the range on a phone is the bag the website and
 * the next round use. Conflicts resolve by whole bag: the newest change wins.
 */

const KEY_PREFIX = "caddy-stack:bag:v1:";
const UNSENT_PREFIX = "caddy-stack:bag-unsent:v1:";
const SESSION_PREFIX = "caddy-stack:range-session:v1:";
const CHANGE_EVENT = "caddy-stack:bag-change";
/** Range logging saves on every ball; one request per pause is plenty. */
const PUSH_DELAY_MS = 900;
const RETRY_DELAYS_MS = [4_000, 15_000, 60_000];

export type BagSyncStatus = "idle" | "syncing" | "synced" | "offline" | "error";

const cache = new Map<string, Bag>();
const statuses = new Map<string, BagSyncStatus>();
let revision = 0;
let syncing = false;
let syncAgain = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let failedAttempts = 0;
let started = false;

function storageKey(golferId: string): string {
  return `${KEY_PREFIX}${golferId}`;
}

function emitChange(): void {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** The bag stored on this device, or null when this device has never saved one. */
function localBag(golferId: string): Bag | null {
  try {
    const raw = window.localStorage.getItem(storageKey(golferId));
    return raw ? normalizeBag(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function readBag(golferId: string | null): Bag {
  if (!golferId || typeof window === "undefined") return DEFAULT_BAG;

  const cached = cache.get(golferId);
  if (cached) return cached;

  const bag = localBag(golferId) ?? DEFAULT_BAG;
  cache.set(golferId, bag);
  return bag;
}

function writeLocal(golferId: string, bag: Bag): void {
  cache.set(golferId, bag);
  try {
    window.localStorage.setItem(storageKey(golferId), JSON.stringify(bag));
  } catch {
    // Storage can be blocked; the in-memory copy still carries the round.
  }
}

function isUnsent(golferId: string): boolean {
  try {
    return window.localStorage.getItem(UNSENT_PREFIX + golferId) === "1";
  } catch {
    return false;
  }
}

function markUnsent(golferId: string, unsent: boolean): void {
  try {
    if (unsent) window.localStorage.setItem(UNSENT_PREFIX + golferId, "1");
    else window.localStorage.removeItem(UNSENT_PREFIX + golferId);
  } catch {
    // Without storage the flag lives as long as the page, which is as long as the bag does.
  }
}

/**
 * Now, or a millisecond past the bag being replaced if this clock is behind the device that
 * wrote it. Otherwise an edit made just after adopting another phone's bag would lose to it.
 */
function nextStamp(previous: Bag): string {
  const now = Date.now();
  const floor = previous.updatedAt ? Date.parse(previous.updatedAt) + 1 : now;
  return new Date(Math.max(now, floor)).toISOString();
}

export function saveBag(golferId: string, bag: Bag): void {
  const normalized = normalizeBag({ ...bag, updatedAt: nextStamp(readBag(golferId)) });
  writeLocal(golferId, normalized);
  markUnsent(golferId, true);
  revision += 1;
  emitChange();
  schedulePush();
}

/** Default distances, keeping the range history of any club the default set still holds. */
export function resetBag(golferId: string): void {
  const previous = readBag(golferId);
  saveBag(golferId, {
    clubs: DEFAULT_BAG.clubs.map((club) => {
      const shots = previous.clubs.find((item) => item.id === club.id)?.shots;
      return shots?.length ? { ...club, shots } : club;
    }),
  });
}

export function readBagSyncStatus(golferId: string | null): BagSyncStatus {
  return (golferId && statuses.get(golferId)) || "idle";
}

function setStatus(golferId: string, status: BagSyncStatus): void {
  if (statuses.get(golferId) === status) return;
  statuses.set(golferId, status);
  emitChange();
}

class BagRequestError extends Error {
  readonly permanent: boolean;

  constructor(status: number) {
    super(`Bag sync failed with status ${status}`);
    this.name = "BagRequestError";
    // A payload the server rejects outright will be rejected every time. Sign-in trouble,
    // timeouts and rate limits are worth another go.
    this.permanent = status >= 400 && status < 500 && ![401, 403, 408, 429].includes(status);
  }
}

async function requestBag(init?: RequestInit): Promise<Bag | null> {
  const response = await fetch(apiUrl("/api/bag"), {
    cache: "no-store",
    ...init,
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...authHeaders() },
  });
  if (!response.ok) throw new BagRequestError(response.status);
  const body = (await response.json()) as { bag?: unknown };
  return body.bag ? normalizeBag(body.bag) : null;
}

const pushBag = (bag: Bag) => requestBag({ method: "PUT", body: JSON.stringify({ bag }) });

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function scheduleRetry(): void {
  if (retryTimer) return;
  const delay = RETRY_DELAYS_MS[Math.min(failedAttempts, RETRY_DELAYS_MS.length) - 1] ?? RETRY_DELAYS_MS[0];
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void syncBag();
  }, delay);
}

function schedulePush(): void {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void syncBag();
  }, PUSH_DELAY_MS);
}

/** Sends this device's changes, or takes the account's newer bag. Safe to call any time. */
export async function syncBag(): Promise<void> {
  if (typeof window === "undefined") return;
  const golferId = readSelectedGolfer()?.id;
  if (!golferId) return;
  if (syncing) {
    syncAgain = true;
    return;
  }
  if (isOffline()) {
    setStatus(golferId, "offline");
    return;
  }

  syncing = true;
  const revisionAtStart = revision;
  setStatus(golferId, "syncing");
  try {
    const local = localBag(golferId);
    let settled: Bag | null;
    if (local && isUnsent(golferId)) {
      settled = await pushBag(local);
    } else {
      const remote = await requestBag();
      // A bag set up on this phone before bags synced goes up the first time it can.
      settled =
        local && (!remote || isNewerBag(local, remote))
          ? await pushBag(local.updatedAt ? local : { ...local, updatedAt: new Date().toISOString() })
          : remote;
    }

    // A change made while the request was out is newer than its answer: keep it and go again.
    if (revision !== revisionAtStart || readSelectedGolfer()?.id !== golferId) {
      syncAgain = true;
    } else {
      if (settled) writeLocal(golferId, settled);
      markUnsent(golferId, false);
    }
    failedAttempts = 0;
    setStatus(golferId, "synced");
  } catch (cause) {
    if (cause instanceof BagRequestError && cause.permanent) {
      console.error("Dropping a bag the server will not accept", cause);
      markUnsent(golferId, false);
      setStatus(golferId, "error");
    } else {
      failedAttempts += 1;
      setStatus(golferId, isOffline() ? "offline" : "error");
      scheduleRetry();
    }
  } finally {
    syncing = false;
    emitChange();
  }

  if (syncAgain) {
    syncAgain = false;
    await syncBag();
  }
}

function start(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  void syncBag();
  subscribeToSelectedGolfer(() => void syncBag());
  window.addEventListener("online", () => void syncBag());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncBag();
  });
}

/** A range session in progress. Device-only: it is a mode, not data. The shots are data. */
export interface RangeSession {
  startedAt: string;
  clubId: string | null;
}

const sessionCache = new Map<string, RangeSession | null>();

export function readRangeSession(golferId: string | null): RangeSession | null {
  if (!golferId || typeof window === "undefined") return null;
  if (sessionCache.has(golferId)) return sessionCache.get(golferId) ?? null;

  let session: RangeSession | null = null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SESSION_PREFIX + golferId) ?? "null") as Partial<RangeSession> | null;
    if (parsed && typeof parsed.startedAt === "string" && !Number.isNaN(Date.parse(parsed.startedAt))) {
      session = { startedAt: parsed.startedAt, clubId: typeof parsed.clubId === "string" ? parsed.clubId : null };
    }
  } catch {
    session = null;
  }
  sessionCache.set(golferId, session);
  return session;
}

function writeRangeSession(golferId: string, session: RangeSession | null): void {
  sessionCache.set(golferId, session);
  try {
    if (session) window.localStorage.setItem(SESSION_PREFIX + golferId, JSON.stringify(session));
    else window.localStorage.removeItem(SESSION_PREFIX + golferId);
  } catch {
    // The session still runs for as long as the page stays open.
  }
  emitChange();
}

export function startRangeSession(golferId: string, clubId: string | null): void {
  writeRangeSession(golferId, { startedAt: new Date().toISOString(), clubId });
}

export function selectRangeClub(golferId: string, clubId: string): void {
  const session = readRangeSession(golferId);
  if (session && session.clubId !== clubId) writeRangeSession(golferId, { ...session, clubId });
}

export function endRangeSession(golferId: string): void {
  writeRangeSession(golferId, null);
}

export function subscribeToBag(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  start();
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && !event.key.startsWith(KEY_PREFIX) && !event.key.startsWith(SESSION_PREFIX)) return;
    // Another tab changed the bag or the session.
    cache.clear();
    sessionCache.clear();
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
