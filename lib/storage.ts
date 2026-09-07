import type { GolfData, GolfRound, RoundEvent, RoundSegment } from "./types";
import { getCourse, getSegmentHoles } from "./courses";

const STORAGE_KEY = "fairway-log:data:v1";
const CHANGE_EVENT = "fairway-log:change";

export const EMPTY_GOLF_DATA: GolfData = {
  version: 1,
  activeRoundId: null,
  rounds: [],
};

let cachedRaw: string | null | undefined;
let cachedData: GolfData = EMPTY_GOLF_DATA;

function validData(value: unknown): value is GolfData {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<GolfData>;
  return data.version === 1 && Array.isArray(data.rounds);
}

export function readGolfData(): GolfData {
  if (typeof window === "undefined") return EMPTY_GOLF_DATA;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === cachedRaw) return cachedData;
  cachedRaw = raw;
  if (!raw) {
    cachedData = EMPTY_GOLF_DATA;
    return cachedData;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    cachedData = validData(parsed) ? parsed : EMPTY_GOLF_DATA;
  } catch {
    cachedData = EMPTY_GOLF_DATA;
  }
  return cachedData;
}

function writeGolfData(data: GolfData): void {
  const raw = JSON.stringify(data);
  window.localStorage.setItem(STORAGE_KEY, raw);
  cachedRaw = raw;
  cachedData = data;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeToGolfData(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
  };
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function startRound(courseId: string, segment: RoundSegment, startPhrase?: string): GolfRound {
  const data = readGolfData();
  const course = getCourse(courseId);
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
    startedAt: now,
    status: "active",
    scores: {},
    events: event ? [event] : [],
  };
  writeGolfData({ ...data, activeRoundId: round.id, rounds: [round, ...data.rounds] });
  return round;
}

export function updateRoundScore(
  roundId: string,
  holeNumber: number,
  strokes: number,
  source: "voice" | "manual",
  rawText?: string,
): void {
  const data = readGolfData();
  const rounds = data.rounds.map((round) => {
    if (round.id !== roundId) return round;
    const event: RoundEvent = {
      id: createId("event"),
      at: new Date().toISOString(),
      source,
      text: rawText ?? `Hole ${holeNumber}, ${strokes} strokes`,
      hole: holeNumber,
      strokes,
    };
    return {
      ...round,
      scores: { ...round.scores, [holeNumber]: strokes },
      events: [event, ...round.events],
    };
  });
  writeGolfData({ ...data, rounds });
}

export function completeRound(roundId: string): void {
  const data = readGolfData();
  const target = data.rounds.find((round) => round.id === roundId);
  if (!target) return;
  const requiredHoles = getSegmentHoles(getCourse(target.courseId), target.segment);
  if (requiredHoles.some((holeItem) => target.scores[holeItem.number] == null)) return;
  const rounds = data.rounds.map((round) =>
    round.id === roundId
      ? { ...round, status: "completed" as const, completedAt: new Date().toISOString() }
      : round,
  );
  writeGolfData({ ...data, activeRoundId: null, rounds });
}

export function discardActiveRound(roundId: string): void {
  const data = readGolfData();
  writeGolfData({
    ...data,
    activeRoundId: null,
    rounds: data.rounds.filter((round) => round.id !== roundId),
  });
}

export function firstUnscoredHole(round: GolfRound): number | null {
  const holes = getSegmentHoles(getCourse(round.courseId), round.segment);
  return holes.find((holeItem) => round.scores[holeItem.number] == null)?.number ?? null;
}
