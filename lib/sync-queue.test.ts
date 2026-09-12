import { describe, expect, it } from "vitest";
import { applyOperations, enqueueOperation, operationsForGolfer, type PendingOperation } from "./sync-queue";
import { GENESEE_VALLEY_SOUTH } from "./courses";
import type { GolfData, GolfRound } from "./types";

function round(id: string, overrides: Partial<GolfRound> = {}): GolfRound {
  return {
    id,
    courseId: GENESEE_VALLEY_SOUTH.id,
    courseName: GENESEE_VALLEY_SOUTH.name,
    location: GENESEE_VALLEY_SOUTH.location,
    segment: "front9",
    tee: GENESEE_VALLEY_SOUTH.tee,
    courseRating: GENESEE_VALLEY_SOUTH.rating,
    courseSlope: GENESEE_VALLEY_SOUTH.slope,
    course: GENESEE_VALLEY_SOUTH,
    startedAt: "2026-09-08T14:00:00.000Z",
    status: "active",
    scores: {},
    events: [],
    ...overrides,
  };
}

const emptyData: GolfData = { version: 2, activeRoundId: null, rounds: [], courses: [] };
const NELL = "golfer-nell";
const RAY = "golfer-ray";

describe("enqueueOperation", () => {
  it("collapses repeated saves of the same game into one pending write", () => {
    const first: PendingOperation = { kind: "save-game", golferId: NELL, round: round("r1") };
    const second: PendingOperation = { kind: "save-game", golferId: NELL, round: round("r1", { scores: { 1: 4 } }) };
    const queue = enqueueOperation(enqueueOperation([], first), second);
    expect(queue).toEqual([second]);
  });

  it("keeps saves for different games", () => {
    const queue = enqueueOperation(
      enqueueOperation([], { kind: "save-game", golferId: NELL, round: round("r1") }),
      { kind: "save-game", golferId: NELL, round: round("r2") },
    );
    expect(queue).toHaveLength(2);
  });

  it("keeps a course write ahead of the game that depends on it", () => {
    const queue = enqueueOperation(
      enqueueOperation([], { kind: "save-course", golferId: NELL, course: GENESEE_VALLEY_SOUTH }),
      { kind: "save-game", golferId: NELL, round: round("r1") },
    );
    expect(queue[0].kind).toBe("save-course");
  });

  it("drops queued writes for a game that is then deleted", () => {
    const queue = enqueueOperation(
      enqueueOperation([], { kind: "save-game", golferId: NELL, round: round("r1") }),
      { kind: "delete-game", golferId: NELL, roundId: "r1" },
    );
    expect(queue).toEqual([{ kind: "delete-game", golferId: NELL, roundId: "r1" }]);
  });

  it("keeps one golfer's pending course write clear of another's", () => {
    const queue = enqueueOperation(
      enqueueOperation([], { kind: "save-course", golferId: NELL, course: GENESEE_VALLEY_SOUTH }),
      { kind: "save-course", golferId: RAY, course: GENESEE_VALLEY_SOUTH },
    );
    expect(queue.map((item) => item.golferId)).toEqual([NELL, RAY]);
  });
});

describe("operationsForGolfer", () => {
  it("hands back only the writes waiting for that golfer", () => {
    const queue: PendingOperation[] = [
      { kind: "save-game", golferId: NELL, round: round("r1") },
      { kind: "save-game", golferId: RAY, round: round("r2") },
      { kind: "delete-game", golferId: NELL, roundId: "r3" },
    ];
    expect(operationsForGolfer(queue, NELL)).toEqual([queue[0], queue[2]]);
    expect(operationsForGolfer(queue, RAY)).toEqual([queue[1]]);
  });
});

describe("applyOperations", () => {
  it("replays unsent writes on top of a server snapshot", () => {
    const pending = round("r2", { scores: { 1: 5 } });
    const snapshot: GolfData = { ...emptyData, rounds: [round("r1", { status: "completed", completedAt: "x" })] };
    const result = applyOperations(snapshot, [{ kind: "save-game", golferId: NELL, round: pending }]);
    expect(result.rounds.map((item) => item.id)).toEqual(["r2", "r1"]);
    expect(result.activeRoundId).toBe("r2");
  });

  it("removes a deleted game and clears the active round", () => {
    const snapshot: GolfData = { ...emptyData, rounds: [round("r1")], activeRoundId: "r1" };
    const result = applyOperations(snapshot, [{ kind: "delete-game", golferId: NELL, roundId: "r1" }]);
    expect(result.rounds).toHaveLength(0);
    expect(result.activeRoundId).toBeNull();
  });
});

describe("forgetting a course", () => {
  const wrongCourse = { ...GENESEE_VALLEY_SOUTH, id: "arrowhead-co", name: "Arrowhead Golf Club", location: "Littleton, CO" };

  it("supersedes a queued save of the same course", () => {
    const queued = enqueueOperation([], { kind: "save-course", golferId: NELL, course: wrongCourse });
    const after = enqueueOperation(queued, { kind: "delete-course", golferId: NELL, courseId: wrongCourse.id });
    expect(after).toEqual([{ kind: "delete-course", golferId: NELL, courseId: wrongCourse.id }]);
  });

  it("does not collapse a delete for a different course", () => {
    const queued = enqueueOperation([], { kind: "save-course", golferId: NELL, course: GENESEE_VALLEY_SOUTH });
    const after = enqueueOperation(queued, { kind: "delete-course", golferId: NELL, courseId: wrongCourse.id });
    expect(after).toHaveLength(2);
  });

  it("leaves another golfer's queued save alone", () => {
    const queued = enqueueOperation([], { kind: "save-course", golferId: RAY, course: wrongCourse });
    const after = enqueueOperation(queued, { kind: "delete-course", golferId: NELL, courseId: wrongCourse.id });
    expect(after).toHaveLength(2);
  });

  it("drops the course when replayed over a server snapshot", () => {
    const snapshot: GolfData = { ...emptyData, courses: [wrongCourse, GENESEE_VALLEY_SOUTH] };
    const operations: PendingOperation[] = [{ kind: "delete-course", golferId: NELL, courseId: wrongCourse.id }];
    expect(applyOperations(snapshot, operations).courses).toEqual([GENESEE_VALLEY_SOUTH]);
  });

  it("leaves rounds untouched", () => {
    const snapshot: GolfData = { ...emptyData, courses: [wrongCourse], rounds: [round("r1")] };
    const after = applyOperations(snapshot, [{ kind: "delete-course", golferId: NELL, courseId: wrongCourse.id }]);
    expect(after.rounds).toHaveLength(1);
    expect(after.courses).toEqual([]);
  });

  it("is idempotent when the queue drains twice", () => {
    const once = enqueueOperation([], { kind: "delete-course", golferId: NELL, courseId: wrongCourse.id });
    const twice = enqueueOperation(once, { kind: "delete-course", golferId: NELL, courseId: wrongCourse.id });
    expect(twice).toHaveLength(1);
  });
});
