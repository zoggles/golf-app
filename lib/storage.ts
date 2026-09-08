import type { Course, GolfData, GolfRound, RoundEvent, RoundSegment } from "./types";
import { getCourse, getSegmentHoles } from "./courses";

const STORAGE_KEY = "fairway-log:data:v1";
const CHANGE_EVENT = "fairway-log:change";

export const EMPTY_GOLF_DATA: GolfData = {
  version: 2,
  activeRoundId: null,
  rounds: [],
  courses: [],
};

let cachedRaw: string | null | undefined;
let cachedData: GolfData = EMPTY_GOLF_DATA;

function normalizeData(value: unknown): GolfData | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<GolfData>;
  if (!Array.isArray(data.rounds)) return null;
  const courses = Array.isArray(data.courses) ? data.courses : [];
  const rounds = data.rounds.map((round) => ({
    ...round,
    course: round.course ?? courses.find((course) => course.id === round.courseId) ?? getCourse(round.courseId),
  }));
  return { version: 2, activeRoundId: data.activeRoundId ?? null, rounds, courses };
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
    cachedData = normalizeData(parsed) ?? EMPTY_GOLF_DATA;
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

export function saveCourse(course: Course): void {
  const data = readGolfData();
  const courses = [course, ...data.courses.filter((item) => item.id !== course.id)];
  writeGolfData({ ...data, courses });
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
  const requiredHoles = getSegmentHoles(target.course ?? getCourse(target.courseId), target.segment);
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

export function updateCompletedRoundScores(roundId: string, scores: Record<number, number>): void {
  const data = readGolfData();
  const now = new Date().toISOString();
  const rounds = data.rounds.map((round) => {
    if (round.id !== roundId || round.status !== "completed") return round;
    const event: RoundEvent = {
      id: createId("event"),
      at: now,
      source: "manual",
      text: "Edited completed scorecard",
    };
    return { ...round, scores: { ...scores }, events: [event, ...round.events] };
  });
  writeGolfData({ ...data, rounds });
}

export function deleteRound(roundId: string): void {
  const data = readGolfData();
  writeGolfData({
    ...data,
    activeRoundId: data.activeRoundId === roundId ? null : data.activeRoundId,
    rounds: data.rounds.filter((round) => round.id !== roundId),
  });
}

export function firstUnscoredHole(round: GolfRound): number | null {
  const holes = getSegmentHoles(round.course ?? getCourse(round.courseId), round.segment);
  return holes.find((holeItem) => round.scores[holeItem.number] == null)?.number ?? null;
}
