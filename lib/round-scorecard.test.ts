import { describe, expect, it } from "vitest";
import { estimateHandicap } from "./metrics";
import { buildRoundScorecard, describeVsTarget, handicapGoingInto } from "./round-scorecard";
import type { HoleHistory } from "./personal-baseline";
import type { Course, GolfRound, RoundSegment } from "./types";

// Front nine and back nine each par 36. Hole 1 is the hardest (HCP 1), hole 18 the easiest.
const PARS = [4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 5, 4];

/** Rating equal to par and a neutral slope, so a round handicap equals the index, rounded. */
const COURSE: Course = {
  id: "test-links-white",
  name: "Test Links",
  shortName: "Test Links",
  location: "Rochester, NY",
  tee: "White",
  rating: 72,
  slope: 113,
  par: 72,
  yards: 6000,
  sourceUrl: "",
  holes: PARS.map((par, index) => ({ number: index + 1, par, yards: 350, handicap: index + 1, suggestedClub: "", strategy: "" })),
};

function played(id: string, day: string, segment: RoundSegment, toPars: number[], status: GolfRound["status"] = "completed"): GolfRound {
  const firstHole = segment === "back9" ? 10 : 1;
  return {
    id,
    courseId: COURSE.id,
    courseName: COURSE.name,
    location: COURSE.location,
    segment,
    tee: "White",
    courseRating: 72,
    courseSlope: 113,
    course: COURSE,
    startedAt: `${day}T13:00:00.000Z`,
    completedAt: status === "completed" ? `${day}T17:00:00.000Z` : undefined,
    status,
    scores: Object.fromEntries(toPars.map((toPar, index) => [firstHole + index, PARS[firstHole + index - 1] + toPar])),
    events: [],
  };
}

const ALL_PARS = Array(18).fill(0);

describe("handicapGoingInto", () => {
  const first = played("first", "2026-08-01", "full18", Array(18).fill(1));
  const second = played("second", "2026-08-10", "full18", Array(18).fill(2));
  const third = played("third", "2026-08-20", "full18", ALL_PARS);
  const later = played("later", "2026-09-01", "full18", Array(18).fill(3));

  it("uses only rounds finished before this one", () => {
    expect(handicapGoingInto([first, second, third, later], third)).toBe(estimateHandicap([first, second]));
  });

  it("is unaffected by rounds played afterwards", () => {
    expect(handicapGoingInto([first, second, third], third)).toBe(handicapGoingInto([first, second, third, later], third));
  });

  it("has nothing to go on for a first round", () => {
    expect(handicapGoingInto([first, second, third], first)).toBeNull();
  });

  it("ignores a round still in progress", () => {
    const active = played("active", "2026-08-05", "full18", ALL_PARS, "active");
    expect(handicapGoingInto([first, active, second], second)).toBe(estimateHandicap([first]));
  });
});

describe("buildRoundScorecard", () => {
  it("adds a stroke on each of the hardest holes up to the round handicap", () => {
    const card = buildRoundScorecard({ round: played("r", "2026-09-01", "full18", ALL_PARS), handicapIndex: 5 });
    expect(card.roundHandicap).toBe(5);
    const holes = card.nines.flatMap((nine) => nine.holes);
    expect(holes.filter((line) => line.strokesReceived === 1).map((line) => line.hole.number)).toEqual([1, 2, 3, 4, 5]);
    expect(holes[0].target).toBe(PARS[0] + 1);
    expect(holes[5].target).toBe(PARS[5]);
    expect(card.target).toBe(72 + 5);
  });

  it("gives a second stroke on the hardest holes once the handicap passes the hole count", () => {
    const card = buildRoundScorecard({ round: played("r", "2026-09-01", "full18", ALL_PARS), handicapIndex: 22 });
    const holes = card.nines.flatMap((nine) => nine.holes);
    expect(holes.slice(0, 4).every((line) => line.strokesReceived === 2)).toBe(true);
    expect(holes.slice(4).every((line) => line.strokesReceived === 1)).toBe(true);
    expect(card.target).toBe(72 + 22);
  });

  it("scores each hole against par and against your handicap target", () => {
    const toPars = [...ALL_PARS];
    toPars[0] = 1;
    toPars[17] = 1;
    const card = buildRoundScorecard({ round: played("r", "2026-09-01", "full18", toPars), handicapIndex: 5 });
    const holes = card.nines.flatMap((nine) => nine.holes);
    // Hole 1 is a bogey, but the hardest hole gives a stroke: right on your handicap target.
    expect(holes[0]).toMatchObject({ vsPar: 1, vsTarget: 0, type: "bogey" });
    // Hole 18 gives no stroke: a bogey there is a stroke over your handicap target too.
    expect(holes[17]).toMatchObject({ vsPar: 1, vsTarget: 1 });
  });

  it("totals the round against par and against your handicap target", () => {
    const card = buildRoundScorecard({ round: played("r", "2026-09-01", "full18", ALL_PARS), handicapIndex: 5 });
    expect(card.score).toBe(72);
    expect(card.vsPar).toBe(0);
    expect(card.vsTarget).toBe(-5);
  });

  it("splits an eighteen into Out and In with their own totals", () => {
    const toPars = [...Array(9).fill(1), ...Array(9).fill(0)];
    const card = buildRoundScorecard({ round: played("r", "2026-09-01", "full18", toPars), handicapIndex: 0 });
    expect(card.nines.map((nine) => [nine.label, nine.holes.length, nine.par, nine.score])).toEqual([
      ["Out", 9, 36, 45],
      ["In", 9, 36, 36],
    ]);
  });

  it("labels a nine-hole round by the half it covers", () => {
    expect(buildRoundScorecard({ round: played("f", "2026-09-01", "front9", Array(9).fill(0)), handicapIndex: 4 }).nines.map((nine) => nine.label)).toEqual(["Out"]);
    expect(buildRoundScorecard({ round: played("b", "2026-09-01", "back9", Array(9).fill(0)), handicapIndex: 4 }).nines.map((nine) => nine.label)).toEqual(["In"]);
  });

  it("shows par alone when there is no handicap to go on", () => {
    const card = buildRoundScorecard({ round: played("r", "2026-09-01", "full18", ALL_PARS), handicapIndex: null });
    expect(card.roundHandicap).toBeNull();
    expect(card.target).toBeNull();
    expect(card.vsTarget).toBeNull();
    expect(card.nines[0].holes.every((line) => line.target === null && line.strokesReceived === 0)).toBe(true);
    expect(card.vsPar).toBe(0);
  });

  it("follows an unsaved correction", () => {
    const round = played("r", "2026-09-01", "full18", ALL_PARS);
    const card = buildRoundScorecard({ round, handicapIndex: 0, scores: { ...round.scores, 1: PARS[0] - 1 } });
    expect(card.nines[0].holes[0].type).toBe("birdie");
    expect(card.vsPar).toBe(-1);
  });

  it("leaves unscored holes out of the totals", () => {
    const round = played("r", "2026-09-01", "full18", ALL_PARS);
    delete round.scores[18];
    const card = buildRoundScorecard({ round, handicapIndex: 0 });
    expect(card.nines[1].holes[8]).toMatchObject({ score: null, vsPar: null, vsTarget: null });
    expect(card.score).toBe(72 - PARS[17]);
    expect(card.par).toBe(72);
  });
});

describe("describeVsTarget", () => {
  it("says it plainly", () => {
    expect(describeVsTarget(-6)).toBe("6 strokes under your handicap target");
    expect(describeVsTarget(1)).toBe("1 stroke over your handicap target");
    expect(describeVsTarget(0)).toBe("Right on your handicap target");
  });
});

/** Hole histories with your own average on each hole given. */
function averages(byHole: Record<number, number>): Map<number, HoleHistory> {
  return new Map(Object.entries(byHole).map(([hole, average]): [number, HoleHistory] => [
    Number(hole),
    { plays: 3, best: null, last: null, baseline: { source: "hole", average, samples: 3, confidence: "early" } },
  ]));
}

describe("against your average", () => {
  it("compares each scored hole with your average", () => {
    const toPars = [...ALL_PARS];
    toPars[0] = 1;
    const card = buildRoundScorecard({ round: played("r", "2026-09-01", "full18", toPars), handicapIndex: null, history: averages({ 1: 6.5, 2: 4 }) });
    const holes = card.nines.flatMap((nine) => nine.holes);
    expect(holes[0].vsAverage).toBeCloseTo(-1.5);
    expect(holes[1].vsAverage).toBe(0);
    expect(holes[2].vsAverage).toBeNull();
    expect(card.comparedHoles).toBe(2);
  });

  it("keeps the handicap target and your average apart", () => {
    const card = buildRoundScorecard({ round: played("r", "2026-09-01", "full18", ALL_PARS), handicapIndex: 5, history: averages({ 1: 6 }) });
    // Hole 1 is the hardest: a stroke from the handicap makes the target 5, while you usually take 6.
    expect(card.nines[0].holes[0]).toMatchObject({ par: 4, target: 5, vsTarget: -1, vsAverage: -2 });
  });

  it("totals a nine only when every hole has an average", () => {
    const front = Object.fromEntries(PARS.slice(0, 9).map((par, index) => [index + 1, par + 1]));
    const card = buildRoundScorecard({ round: played("r", "2026-09-01", "full18", ALL_PARS), handicapIndex: null, history: averages(front) });
    expect(card.nines[0]).toMatchObject({ average: 45, vsAverage: -9 });
    expect(card.nines[1]).toMatchObject({ average: null, vsAverage: null });
    expect(card).toMatchObject({ average: null, vsAverage: null });
  });

  it("leaves unscored holes out of the comparison", () => {
    const front = Object.fromEntries(PARS.slice(0, 9).map((par, index) => [index + 1, par]));
    const round = played("r", "2026-09-01", "front9", Array(9).fill(1));
    delete round.scores[9];
    const card = buildRoundScorecard({ round, handicapIndex: null, history: averages(front) });
    expect(card.nines[0]).toMatchObject({ average: 36, score: 36 - PARS[8] + 8, vsAverage: 8 });
  });
});
