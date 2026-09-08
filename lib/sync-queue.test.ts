import { describe, expect, it } from "vitest";
import { applyOperations, enqueueOperation, type PendingOperation } from "./sync-queue";
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

describe("enqueueOperation", () => {
  it("collapses repeated saves of the same game into one pending write", () => {
    const first: PendingOperation = { kind: "save-game", round: round("r1") };
    const second: PendingOperation = { kind: "save-game", round: round("r1", { scores: { 1: 4 } }) };
    const queue = enqueueOperation(enqueueOperation([], first), second);
    expect(queue).toEqual([second]);
  });

  it("keeps saves for different games", () => {
    const queue = enqueueOperation(
      enqueueOperation([], { kind: "save-game", round: round("r1") }),
      { kind: "save-game", round: round("r2") },
    );
    expect(queue).toHaveLength(2);
  });

  it("keeps a course write ahead of the game that depends on it", () => {
    const queue = enqueueOperation(
      enqueueOperation([], { kind: "save-course", course: GENESEE_VALLEY_SOUTH }),
      { kind: "save-game", round: round("r1") },
    );
    expect(queue[0].kind).toBe("save-course");
  });

  it("drops queued writes for a game that is then deleted", () => {
    const queue = enqueueOperation(
      enqueueOperation([], { kind: "save-game", round: round("r1") }),
      { kind: "delete-game", roundId: "r1" },
    );
    expect(queue).toEqual([{ kind: "delete-game", roundId: "r1" }]);
  });
});

describe("applyOperations", () => {
  it("replays unsent writes on top of a server snapshot", () => {
    const pending = round("r2", { scores: { 1: 5 } });
    const snapshot: GolfData = { ...emptyData, rounds: [round("r1", { status: "completed", completedAt: "x" })] };
    const result = applyOperations(snapshot, [{ kind: "save-game", round: pending }]);
    expect(result.rounds.map((item) => item.id)).toEqual(["r2", "r1"]);
    expect(result.activeRoundId).toBe("r2");
  });

  it("removes a deleted game and clears the active round", () => {
    const snapshot: GolfData = { ...emptyData, rounds: [round("r1")], activeRoundId: "r1" };
    const result = applyOperations(snapshot, [{ kind: "delete-game", roundId: "r1" }]);
    expect(result.rounds).toHaveLength(0);
    expect(result.activeRoundId).toBeNull();
  });
});
