"use client";

import type { Golfer } from "./golfers";
import { apiUrl } from "./api-url";
import { authHeaders } from "./auth-client";

/** Cached display profile. Authorization always comes from the verified session. */

const SELECTED_KEY = "caddy-stack:account:v2";
const CHANGE_EVENT = "fairway-log:golfer-change";

let selected: Golfer | null = null;
let restored = false;

function restore(): void {
  if (restored || typeof window === "undefined") return;
  restored = true;
  try {
    const raw = window.localStorage.getItem(SELECTED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") {
      const candidate = parsed as Partial<Golfer>;
      if (typeof candidate.id === "string" && typeof candidate.name === "string") {
        selected = { id: candidate.id, name: candidate.name, accountId: candidate.accountId };
      }
    }
  } catch {
    selected = null;
  }
}

export function readSelectedGolfer(): Golfer | null {
  if (typeof window === "undefined") return null;
  restore();
  return selected;
}

export function selectGolfer(golfer: Golfer | null): void {
  restored = true;
  selected = golfer;
  try {
    if (golfer) window.localStorage.setItem(SELECTED_KEY, JSON.stringify(golfer));
    else window.localStorage.removeItem(SELECTED_KEY);
  } catch {
    // A blocked storage quota must not stop the golfer from playing.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeToSelectedGolfer(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== SELECTED_KEY) return;
    // Another tab switched golfers.
    restored = false;
    restore();
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Attaches the verified Supabase session to every protected request. */
export function golferHeaders(golferId?: string): Record<string, string> {
  void golferId;
  return authHeaders();
}

/** The one golf profile owned by the signed-in account. */
export interface RosterState {
  golfers: Golfer[] | null;
  error: string | null;
}

export const EMPTY_ROSTER: RosterState = { golfers: null, error: null };

const rosterListeners = new Set<() => void>();
let rosterSnapshot: RosterState = EMPTY_ROSTER;
let rosterLoading = false;

function publishRoster(next: RosterState): void {
  rosterSnapshot = next;
  rosterListeners.forEach((listener) => listener());
}

export async function refreshRoster(): Promise<void> {
  if (rosterLoading) return;
  rosterLoading = true;
  try {
    const response = await fetch(apiUrl("/api/golfers"), { cache: "no-store", headers: authHeaders() });
    const result = (await response.json()) as { golfers?: Golfer[]; error?: string };
    if (!response.ok || !result.golfers) throw new Error(result.error || "Could not load golfers.");
    // A golfer removed elsewhere would otherwise leave this browser pointing at
    // an id nothing will accept. Only a successful load can decide that, so an
    // offline or failed refresh never signs anyone out.
    const stored = readSelectedGolfer();
    if (stored && !result.golfers.some((golfer) => golfer.id === stored.id)) selectGolfer(null);
    publishRoster({ golfers: result.golfers, error: null });
  } catch (cause) {
    publishRoster({
      golfers: rosterSnapshot.golfers,
      error: cause instanceof Error ? cause.message : "Could not load golfers.",
    });
  } finally {
    rosterLoading = false;
  }
}

export function readRoster(): RosterState {
  return rosterSnapshot;
}

export function subscribeToRoster(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  rosterListeners.add(onChange);
  return () => void rosterListeners.delete(onChange);
}

export function clearGolferSession(): void {
  selectGolfer(null);
  publishRoster(EMPTY_ROSTER);
}

/** Keeps the roster current without a round trip after a local change. */
function mergeIntoRoster(golfer: Golfer): void {
  const existing = rosterSnapshot.golfers ?? [];
  const known = existing.some((item) => item.id === golfer.id);
  publishRoster({
    golfers: known ? existing.map((item) => (item.id === golfer.id ? golfer : item)) : [...existing, golfer],
    error: null,
  });
}

export async function renameSelectedGolfer(name: string): Promise<Golfer> {
  const response = await fetch(apiUrl("/api/golfers"), {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...golferHeaders() },
    body: JSON.stringify({ name }),
  });
  const result = (await response.json()) as { golfer?: Golfer; error?: string };
  if (!response.ok || !result.golfer) throw new Error(result.error || "Could not rename that golfer.");
  selectGolfer(result.golfer);
  mergeIntoRoster(result.golfer);
  return result.golfer;
}
