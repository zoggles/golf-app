import type { Course, GolfData, GolfRound } from "./types";

/**
 * Pure helpers for the offline write queue.
 *
 * Every operation carries the complete record it wants stored, so replaying one
 * is idempotent and a failed flush can simply be retried later.
 */
export type PendingOperation =
  | { kind: "save-course"; course: Course }
  | { kind: "save-game"; round: GolfRound }
  | { kind: "delete-game"; roundId: string };

/**
 * Adds an operation, collapsing it into an earlier pending write for the same
 * record. Nine holes of score edits stay a single queued game upsert.
 */
export function enqueueOperation(queue: PendingOperation[], operation: PendingOperation): PendingOperation[] {
  if (operation.kind === "save-course") {
    const index = queue.findIndex((item) => item.kind === "save-course" && item.course.id === operation.course.id);
    if (index === -1) return [...queue, operation];
    return queue.map((item, position) => (position === index ? operation : item));
  }

  if (operation.kind === "save-game") {
    const index = queue.findIndex((item) => item.kind === "save-game" && item.round.id === operation.round.id);
    if (index === -1) return [...queue, operation];
    return queue.map((item, position) => (position === index ? operation : item));
  }

  // A delete supersedes any queued writes for that game.
  const remaining = queue.filter(
    (item) =>
      !(item.kind === "save-game" && item.round.id === operation.roundId) &&
      !(item.kind === "delete-game" && item.roundId === operation.roundId),
  );
  return [...remaining, operation];
}

export function deriveActiveRoundId(rounds: GolfRound[]): string | null {
  return rounds.find((round) => round.status === "active")?.id ?? null;
}

function upsertRound(rounds: GolfRound[], round: GolfRound): GolfRound[] {
  const index = rounds.findIndex((item) => item.id === round.id);
  if (index === -1) return [round, ...rounds];
  return rounds.map((item, position) => (position === index ? round : item));
}

function upsertCourse(courses: Course[], course: Course): Course[] {
  const index = courses.findIndex((item) => item.id === course.id);
  if (index === -1) return [course, ...courses];
  return courses.map((item, position) => (position === index ? course : item));
}

/** Replays unsent operations on top of a server snapshot. */
export function applyOperations(data: GolfData, operations: PendingOperation[]): GolfData {
  const next = operations.reduce<GolfData>((current, operation) => {
    if (operation.kind === "save-course") {
      return { ...current, courses: upsertCourse(current.courses, operation.course) };
    }
    if (operation.kind === "save-game") {
      return { ...current, rounds: upsertRound(current.rounds, operation.round) };
    }
    return { ...current, rounds: current.rounds.filter((round) => round.id !== operation.roundId) };
  }, data);

  return { ...next, activeRoundId: deriveActiveRoundId(next.rounds) };
}
