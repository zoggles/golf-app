import { describe, expect, it } from "vitest";
import { GENESEE_VALLEY_SOUTH } from "./courses";
import { buildRoundInsights, estimateHandicap, estimateRoundHandicap, handicapStrokesForHole, holeMetricsByNumber, trackedRoundMetrics } from "./metrics";
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

/** An eighteen at Genesee Valley South, `day` days into 2026, every hole scored the same. */
function playedRound(id: string, day: number, strokesPerHole: number): GolfRound {
  const at = new Date(Date.UTC(2026, 0, 1) + day * 86_400_000).toISOString();
  return {
    ...trackedRound(id, 2, "hit", 0),
    segment: "full18",
    startedAt: at,
    completedAt: at,
    scores: Object.fromEntries(GENESEE_VALLEY_SOUTH.holes.map((hole) => [hole.number, strokesPerHole])),
    events: [],
  };
}

const rounds = (prefix: string, count: number, firstDay: number, strokesPerHole: number) =>
  Array.from({ length: count }, (_, index) => playedRound(`${prefix}-${index}`, firstDay + index, strokesPerHole));

describe("handicap index", () => {
  // Rating 65.2 and slope 109: a 90 is a 25.7 differential and a 72 is a 7.0.
  it("averages the best 40% of the differentials", () => {
    expect(estimateHandicap(rounds("ninety", 5, 0, 5))).toBe(25.7);
    expect(estimateHandicap([...rounds("ninety", 4, 0, 5), playedRound("seventy-two", 10, 4)])).toBe(16.4);
  });

  it("looks only at the latest 20 rounds, however they are ordered", () => {
    const recent = rounds("recent", 20, 100, 5);
    const oldBest = playedRound("old-best", 0, 4);
    expect(estimateHandicap([...recent, oldBest])).toBe(25.7);
  });

  it("rises when recent rounds are worse than old ones", () => {
    const sharpYear = rounds("sharp", 20, 0, 4);
    expect(estimateHandicap(sharpYear)).toBe(7);
    expect(estimateHandicap([...sharpYear, ...rounds("rusty", 20, 200, 5)])).toBe(25.7);
  });

  it("skips rounds shorter than nine holes and unfinished rounds", () => {
    const short = { ...playedRound("short", 300, 4), scores: { 1: 4, 2: 4 } };
    const unfinished = { ...playedRound("unfinished", 301, 4), status: "active" as const };
    expect(estimateHandicap([...rounds("ninety", 5, 0, 5), short, unfinished])).toBe(25.7);
    expect(estimateHandicap([short])).toBeNull();
  });
});

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
