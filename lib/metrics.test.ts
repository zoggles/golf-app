import { describe, expect, it } from "vitest";
import { GENESEE_VALLEY_SOUTH } from "./courses";
import { buildRoundInsights, estimateRoundHandicap, handicapStrokesForHole, holeMetricsByNumber, trackedRoundMetrics } from "./metrics";
import type { GolfRound } from "./types";

function trackedRound(id: string, putts: number, fairway: "hit" | "miss", penaltyStrokes: number): GolfRound {
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
    startedAt: "2026-09-08T12:00:00.000Z",
    completedAt: "2026-09-08T15:00:00.000Z",
    status: "completed",
    scores: { 1: 4, 2: 7 },
    events: [{ id: `${id}-event`, at: "2026-09-08T15:00:00.000Z", source: "manual", text: "stats", hole: 1, metrics: { putts, fairway, penaltyStrokes, blowUp: false } }],
  };
}

describe("round handicap", () => {
  it("adjusts a handicap index for the course, tee, and round length", () => {
    expect(estimateRoundHandicap(18, GENESEE_VALLEY_SOUTH, "full18")).toBe(16);
    expect(estimateRoundHandicap(18, GENESEE_VALLEY_SOUTH, "front9")).toBe(7);
  });

  it("allocates round handicap strokes using each hole's difficulty rank", () => {
    const holes = GENESEE_VALLEY_SOUTH.holes;
    const hardest = holes.find((hole) => hole.handicap === 1)!;
    const fifthHardest = holes.find((hole) => hole.handicap === 5)!;
    const easiest = holes.find((hole) => hole.handicap === 18)!;

    expect(handicapStrokesForHole(11, fifthHardest, holes)).toBe(1);
    expect(handicapStrokesForHole(11, easiest, holes)).toBe(0);
    expect(handicapStrokesForHole(20, hardest, holes)).toBe(2);
  });
});

describe("tracked on-course metrics", () => {
  it("preserves explicit zero and false values while leaving missing holes unknown", () => {
    const round = trackedRound("steady", 2, "hit", 0);
    expect(holeMetricsByNumber(round)[1]).toEqual({ putts: 2, penaltyStrokes: 0, fairway: "hit", blowUp: false });
    expect(holeMetricsByNumber(round)[2]).toBeUndefined();
    expect(trackedRoundMetrics(round)).toMatchObject({ puttsTotal: 2, puttsHoles: 1, penaltyStrokes: 0, penaltyHoles: 1, fairwaysHit: 1, fairwaysTracked: 1, blowUpHoles: 1 });
  });

  it("highlights personal best and worst aspects only from comparable data", () => {
    const good = trackedRound("good", 1, "hit", 0);
    const rough = trackedRound("rough", 4, "miss", 2);
    const insights = buildRoundInsights([good, rough]);
    expect(insights.get("good")).toEqual(expect.arrayContaining([{ tone: "strength", text: "1.0 putts/hole" }]));
    expect(insights.get("rough")).toEqual(expect.arrayContaining([expect.objectContaining({ tone: "focus" })]));
  });
});
