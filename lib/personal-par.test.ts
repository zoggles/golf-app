import { describe, expect, it } from "vitest";
import { estimateHandicap } from "./metrics";
import { buildPersonalScorecard, describeVsYourPar, handicapGoingInto } from "./personal-par";
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

describe("buildPersonalScorecard", () => {
  it("adds a stroke on each of the hardest holes up to the round handicap", () => {
    const card = buildPersonalScorecard({ round: played("r", "2026-09-01", "full18", ALL_PARS), handicapIndex: 5 });
    expect(card.roundHandicap).toBe(5);
    const holes = card.nines.flatMap((nine) => nine.holes);
    expect(holes.filter((line) => line.strokesReceived === 1).map((line) => line.hole.number)).toEqual([1, 2, 3, 4, 5]);
    expect(holes[0].yourPar).toBe(PARS[0] + 1);
    expect(holes[5].yourPar).toBe(PARS[5]);
    expect(card.yourPar).toBe(72 + 5);
  });

  it("gives a second stroke on the hardest holes once the handicap passes the hole count", () => {
    const card = buildPersonalScorecard({ round: played("r", "2026-09-01", "full18", ALL_PARS), handicapIndex: 22 });
    const holes = card.nines.flatMap((nine) => nine.holes);
    expect(holes.slice(0, 4).every((line) => line.strokesReceived === 2)).toBe(true);
    expect(holes.slice(4).every((line) => line.strokesReceived === 1)).toBe(true);
    expect(card.yourPar).toBe(72 + 22);
  });

  it("scores each hole against par and against your par", () => {
    const toPars = [...ALL_PARS];
    toPars[0] = 1;
    toPars[17] = 1;
    const card = buildPersonalScorecard({ round: played("r", "2026-09-01", "full18", toPars), handicapIndex: 5 });
    const holes = card.nines.flatMap((nine) => nine.holes);
    // Hole 1 is a bogey, but the hardest hole gives a stroke: right on your par.
    expect(holes[0]).toMatchObject({ vsPar: 1, vsYourPar: 0, type: "bogey" });
    // Hole 18 gives no stroke: a bogey there is a stroke over your par too.
    expect(holes[17]).toMatchObject({ vsPar: 1, vsYourPar: 1 });
  });

  it("totals the round against par and against your par", () => {
    const card = buildPersonalScorecard({ round: played("r", "2026-09-01", "full18", ALL_PARS), handicapIndex: 5 });
    expect(card.score).toBe(72);
    expect(card.vsPar).toBe(0);
    expect(card.vsYourPar).toBe(-5);
  });

  it("splits an eighteen into Out and In with their own totals", () => {
    const toPars = [...Array(9).fill(1), ...Array(9).fill(0)];
    const card = buildPersonalScorecard({ round: played("r", "2026-09-01", "full18", toPars), handicapIndex: 0 });
    expect(card.nines.map((nine) => [nine.label, nine.holes.length, nine.par, nine.score])).toEqual([
      ["Out", 9, 36, 45],
      ["In", 9, 36, 36],
    ]);
  });

  it("labels a nine-hole round by the half it covers", () => {
    expect(buildPersonalScorecard({ round: played("f", "2026-09-01", "front9", Array(9).fill(0)), handicapIndex: 4 }).nines.map((nine) => nine.label)).toEqual(["Out"]);
    expect(buildPersonalScorecard({ round: played("b", "2026-09-01", "back9", Array(9).fill(0)), handicapIndex: 4 }).nines.map((nine) => nine.label)).toEqual(["In"]);
  });

  it("shows par alone when there is no handicap to go on", () => {
    const card = buildPersonalScorecard({ round: played("r", "2026-09-01", "full18", ALL_PARS), handicapIndex: null });
    expect(card.roundHandicap).toBeNull();
    expect(card.yourPar).toBeNull();
    expect(card.vsYourPar).toBeNull();
    expect(card.nines[0].holes.every((line) => line.yourPar === null && line.strokesReceived === 0)).toBe(true);
    expect(card.vsPar).toBe(0);
  });

  it("follows an unsaved correction", () => {
    const round = played("r", "2026-09-01", "full18", ALL_PARS);
    const card = buildPersonalScorecard({ round, handicapIndex: 0, scores: { ...round.scores, 1: PARS[0] - 1 } });
    expect(card.nines[0].holes[0].type).toBe("birdie");
    expect(card.vsPar).toBe(-1);
  });

  it("leaves unscored holes out of the totals", () => {
    const round = played("r", "2026-09-01", "full18", ALL_PARS);
    delete round.scores[18];
    const card = buildPersonalScorecard({ round, handicapIndex: 0 });
    expect(card.nines[1].holes[8]).toMatchObject({ score: null, vsPar: null, vsYourPar: null });
    expect(card.score).toBe(72 - PARS[17]);
    expect(card.par).toBe(72);
  });
});

describe("describeVsYourPar", () => {
  it("says it plainly", () => {
    expect(describeVsYourPar(-6)).toBe("6 strokes under your par");
    expect(describeVsYourPar(1)).toBe("1 stroke over your par");
    expect(describeVsYourPar(0)).toBe("Right on your par");
  });
});
