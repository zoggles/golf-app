"use client";

import type { Course, GolfData, GolfRound, HoleMetrics, RoundEvent, RoundSegment } from "./types";
import { getCourse, getSegmentHoles } from "./courses";
import { golferHeaders, readSelectedGolfer, subscribeToSelectedGolfer } from "./golfer-session";
import { shiftRoundToDate } from "./round-date";
import {
  applyOperations,
  deriveActiveRoundId,
  enqueueOperation,
  operationsForGolfer,
  type PendingOperation,
} from "./sync-queue";

/**
 * Data adapter for the app.
 *
 * Supabase is the source of truth. The browser keeps a local mirror so the UI
 * stays instant and a round survives a dead zone on the course: every mutation
 * updates the mirror, then queues an idempotent write that drains to the
 * database as soon as the network allows.
 *
 * Everything here is scoped to the selected golfer. The mirror is kept per
 * golfer so switching shows the right history instantly and offline, while the
 * queue is shared so one golfer's unsent rounds still drain after a switch.
 */

const CACHE_PREFIX = "fairway-log:cache:v2:";
const QUEUE_KEY = "fairway-log:queue:v2";
const CHANGE_EVENT = "fairway-log:change";
const RETRY_DELAYS_MS = [3_000, 10_000, 30_000, 60_000];

export const EMPTY_GOLF_DATA: GolfData = {
  version: 2,
  activeRoundId: null,
  rounds: [],
  courses: [],
};

let cachedData: GolfData = EMPTY_GOLF_DATA;
let queue: PendingOperation[] = [];
let cachedGolferId: string | null = null;
let restored = false;
let started = false;
let flushing = false;
let flushAgain = false;
let failedAttempts = 0;
let mutationRevision = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function normalizeData(value: unknown): GolfData | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<GolfData>;
  if (!Array.isArray(data.rounds)) return null;
  const courses = Array.isArray(data.courses) ? data.courses : [];
  const rounds = data.rounds.map((round) => ({
    ...round,
    course: round.course ?? courses.find((course) => course.id === round.courseId) ?? getCourse(round.courseId),
  }));
  return { version: 2, activeRoundId: data.activeRoundId ?? deriveActiveRoundId(rounds), rounds, courses };
}

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A full or blocked storage quota must never break scoring.
  }
}

function currentGolferId(): string | null {
  return readSelectedGolfer()?.id ?? null;
}

function cacheKey(golferId: string): string {
  return CACHE_PREFIX + golferId;
}

function readMirror(golferId: string | null): GolfData {
  if (!golferId) return EMPTY_GOLF_DATA;
  return normalizeData(readJson(cacheKey(golferId))) ?? EMPTY_GOLF_DATA;
}

function restoreFromCache(): void {
  if (typeof window === "undefined") return;
  const golferId = currentGolferId();
  // A switch swaps the whole mirror, so none of the previous golfer's rounds
  // are left on screen while the new one loads.
  if (restored && golferId === cachedGolferId) return;
  restored = true;
  cachedGolferId = golferId;
  cachedData = readMirror(golferId);
  queue = readJson<PendingOperation[]>(QUEUE_KEY) ?? [];
}

function emitChange(): void {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function setData(next: GolfData): void {
  cachedData = next;
  if (cachedGolferId) writeJson(cacheKey(cachedGolferId), next);
  emitChange();
}

function persistQueue(): void {
  writeJson(QUEUE_KEY, queue);
}

/** A mutation names the record it wants stored; the golfer is stamped here. */
type UnownedOperation =
  | { kind: "save-course"; course: Course }
  | { kind: "save-game"; round: GolfRound }
  | { kind: "delete-game"; roundId: string };

function queueOperation(operation: UnownedOperation): void {
  const golferId = currentGolferId();
  // Nothing is stored without a golfer to store it for. The app does not offer
  // scoring until one is selected, so this is a guard rather than a path.
  if (!golferId) return;
  mutationRevision += 1;
  queue = enqueueOperation(queue, { ...operation, golferId });
  persistQueue();
  failedAttempts = 0;
  void flushQueue();
}

function scheduleRetry(): void {
  if (retryTimer) return;
  const delay = RETRY_DELAYS_MS[Math.min(failedAttempts, RETRY_DELAYS_MS.length - 1)];
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void sync();
  }, delay);
}

/** Resolves once the write has landed; throws when it is worth retrying. */
async function sendOperation(operation: PendingOperation): Promise<void> {
  // The queued golfer travels with the write, so a round logged before a switch
  // still lands in the history it was played for.
  const headers = { "Content-Type": "application/json", ...golferHeaders(operation.golferId) };
  const request =
    operation.kind === "save-course"
      ? fetch("/api/courses", {
          method: "POST",
          headers,
          body: JSON.stringify(operation.course),
        })
      : operation.kind === "save-game"
        ? fetch("/api/games", {
            method: "POST",
            headers,
            body: JSON.stringify(operation.round),
          })
        : fetch(`/api/games?id=${encodeURIComponent(operation.roundId)}`, { method: "DELETE", headers });

  const response = await request;
  if (response.ok) return;

  // A 4xx means this payload will never be accepted; dropping it keeps the queue
  // from blocking every later write behind one bad record. Timeouts and rate
  // limits are the exception — those are worth another try.
  if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
    console.error("Dropping a golf write the database rejected", operation.kind, await response.text());
    return;
  }
  throw new Error(`Golf write failed with status ${response.status}`);
}

async function flushQueue(): Promise<void> {
  if (typeof window === "undefined") return;
  if (flushing) {
    // Signal returning while a doomed flush is still awaiting its failing
    // request would otherwise be swallowed, leaving the round to wait out the
    // backoff. The pass already running picks this up instead.
    flushAgain = true;
    return;
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    scheduleRetry();
    return;
  }
  flushing = true;
  try {
    while (queue.length > 0) {
      const operation = queue[0];
      await sendOperation(operation);
      const index = queue.indexOf(operation);
      // A score logged while this request was in flight collapses into the same
      // slot as a newer object. Removing by identity keeps that newer write
      // queued instead of discarding it along with the one that just landed.
      if (index !== -1) {
        queue = queue.filter((_, position) => position !== index);
        persistQueue();
      }
      failedAttempts = 0;
    }
  } catch {
    failedAttempts += 1;
    scheduleRetry();
  } finally {
    flushing = false;
  }

  if (flushAgain) {
    flushAgain = false;
    await flushQueue();
  }
}

async function hydrateFromServer(): Promise<void> {
  const revisionAtStart = mutationRevision;
  const golferId = currentGolferId();
  if (!golferId) return;
  try {
    const response = await fetch("/api/golf-data", { cache: "no-store", headers: golferHeaders(golferId) });
    if (!response.ok) return;
    const snapshot = normalizeData(await response.json());
    if (!snapshot) return;
    // A round logged while this request was in flight is newer than the
    // snapshot, so the snapshot is dropped rather than allowed to overwrite it.
    if (mutationRevision !== revisionAtStart) return;
    // A switch while this request was in flight makes the snapshot the wrong
    // golfer's history.
    if (currentGolferId() !== golferId) return;
    // Local writes that have not drained yet stay on top of the server view.
    setData(applyOperations(snapshot, operationsForGolfer(queue, golferId)));
  } catch {
    // Offline or mid-deploy: the cached mirror keeps the app usable.
  }
}

/** Drains pending writes first, then refreshes from the database. */
async function sync(): Promise<void> {
  await flushQueue();
  if (queue.length > 0) return;
  await hydrateFromServer();
}

function start(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  restoreFromCache();
  void sync();
  subscribeToSelectedGolfer(() => {
    restoreFromCache();
    emitChange();
    void sync();
  });
  window.addEventListener("online", () => void sync());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void sync();
  });
}

export function readGolfData(): GolfData {
  if (typeof window === "undefined") return EMPTY_GOLF_DATA;
  restoreFromCache();
  return cachedData;
}

export function subscribeToGolfData(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  start();
  const onExternalChange = () => {
    // Another tab wrote to the mirror.
    cachedGolferId = currentGolferId();
    cachedData = readMirror(cachedGolferId);
    queue = readJson<PendingOperation[]>(QUEUE_KEY) ?? [];
    onStoreChange();
  };
  window.addEventListener("storage", onExternalChange);
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onExternalChange);
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
  };
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function saveCourse(course: Course): void {
  const data = readGolfData();
  const courses = [course, ...data.courses.filter((item) => item.id !== course.id)];
  setData({ ...data, courses });
  queueOperation({ kind: "save-course", course });
}

export function startRound(course: Course, segment: RoundSegment, startPhrase?: string): GolfRound {
  const data = readGolfData();
  const now = new Date().toISOString();
  const event: RoundEvent | null = startPhrase
    ? { id: createId("event"), at: now, source: "voice", text: startPhrase }
    : null;
  const round: GolfRound = {
    id: createId("round"),
    courseId: course.id,
    courseName: course.name,
    location: course.location,
    segment,
    tee: course.tee,
    courseRating: course.rating,
    courseSlope: course.slope,
    course,
    startedAt: now,
    status: "active",
    scores: {},
    events: event ? [event] : [],
  };
  setData({ ...data, activeRoundId: round.id, rounds: [round, ...data.rounds] });
  queueOperation({ kind: "save-course", course });
  queueOperation({ kind: "save-game", round });
  return round;
}

/**
 * Files an already-played round, such as one read off a photographed paper
 * scorecard. It lands completed and never becomes the active round, so a game
 * in progress on the phone is left alone.
 */
export function importCompletedRound(input: {
  course: Course;
  segment: RoundSegment;
  scores: Record<number, number>;
  playedAt: string;
  note: string;
}): GolfRound {
  const data = readGolfData();
  const round: GolfRound = {
    id: createId("round"),
    courseId: input.course.id,
    courseName: input.course.name,
    location: input.course.location,
    segment: input.segment,
    tee: input.course.tee,
    courseRating: input.course.rating,
    courseSlope: input.course.slope,
    course: input.course,
    startedAt: input.playedAt,
    completedAt: input.playedAt,
    status: "completed",
    scores: { ...input.scores },
    events: [{ id: createId("event"), at: new Date().toISOString(), source: "manual", text: input.note }],
  };
  const courses = [input.course, ...data.courses.filter((item) => item.id !== input.course.id)];
  setData({ ...data, courses, rounds: [round, ...data.rounds] });
  queueOperation({ kind: "save-course", course: input.course });
  queueOperation({ kind: "save-game", round });
  return round;
}

function saveRound(data: GolfData, round: GolfRound, activeRoundId?: string | null): void {
  const rounds = data.rounds.map((item) => (item.id === round.id ? round : item));
  setData({
    ...data,
    rounds,
    activeRoundId: activeRoundId === undefined ? data.activeRoundId : activeRoundId,
  });
  queueOperation({ kind: "save-game", round });
}

export function updateRoundScore(
  roundId: string,
  holeNumber: number,
  strokes: number,
  source: "voice" | "manual",
  rawText?: string,
): void {
  const data = readGolfData();
  const target = data.rounds.find((round) => round.id === roundId);
  if (!target) return;
  const event: RoundEvent = {
    id: createId("event"),
    at: new Date().toISOString(),
    source,
    text: rawText ?? `Hole ${holeNumber}, ${strokes} strokes`,
    hole: holeNumber,
    strokes,
  };
  saveRound(data, {
    ...target,
    scores: { ...target.scores, [holeNumber]: strokes },
    events: [event, ...target.events],
  });
}

export function updateRoundHoleMetrics(
  roundId: string,
  holeNumber: number,
  metrics: HoleMetrics,
  source: "voice" | "manual",
  rawText?: string,
): void {
  const data = readGolfData();
  const target = data.rounds.find((round) => round.id === roundId);
  if (!target || Object.keys(metrics).length === 0) return;
  const event: RoundEvent = {
    id: createId("event"),
    at: new Date().toISOString(),
    source,
    text: rawText ?? `Updated optional stats for hole ${holeNumber}`,
    hole: holeNumber,
    metrics,
  };
  saveRound(data, { ...target, events: [event, ...target.events] });
}

export function completeRound(roundId: string): void {
  const data = readGolfData();
  const target = data.rounds.find((round) => round.id === roundId);
  if (!target) return;
  const requiredHoles = getSegmentHoles(target.course ?? getCourse(target.courseId), target.segment);
  if (requiredHoles.some((holeItem) => target.scores[holeItem.number] == null)) return;
  saveRound(
    data,
    { ...target, status: "completed", completedAt: new Date().toISOString() },
    null,
  );
}

export function discardActiveRound(roundId: string): void {
  const data = readGolfData();
  setData({
    ...data,
    activeRoundId: null,
    rounds: data.rounds.filter((round) => round.id !== roundId),
  });
  queueOperation({ kind: "delete-game", roundId });
}

/**
 * Corrects a round already in the books: its scores, the day it was played, or
 * both in one write. A new round still starts today; this is for fixing history
 * after the fact.
 */
export function updateCompletedRound(
  roundId: string,
  changes: { scores?: Record<number, number>; playedOn?: string },
): void {
  const data = readGolfData();
  const target = data.rounds.find((round) => round.id === roundId);
  if (!target || target.status !== "completed") return;

  const shifted = changes.playedOn ? shiftRoundToDate(target, changes.playedOn) : null;
  if (!changes.scores && !shifted) return;

  const text = changes.scores
    ? shifted
      ? `Edited the scorecard and moved the round to ${changes.playedOn}`
      : "Edited the scorecard"
    : `Moved the round to ${changes.playedOn}`;
  const event: RoundEvent = {
    id: createId("event"),
    at: new Date().toISOString(),
    source: "manual",
    text,
  };

  saveRound(data, {
    ...target,
    ...(changes.scores ? { scores: { ...changes.scores } } : {}),
    ...(shifted ?? {}),
    events: [event, ...target.events],
  });
}

export function deleteRound(roundId: string): void {
  const data = readGolfData();
  setData({
    ...data,
    activeRoundId: data.activeRoundId === roundId ? null : data.activeRoundId,
    rounds: data.rounds.filter((round) => round.id !== roundId),
  });
  queueOperation({ kind: "delete-game", roundId });
}

export function firstUnscoredHole(round: GolfRound): number | null {
  const holes = getSegmentHoles(round.course ?? getCourse(round.courseId), round.segment);
  return holes.find((holeItem) => round.scores[holeItem.number] == null)?.number ?? null;
}
