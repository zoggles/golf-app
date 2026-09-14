import { describe, expect, it } from "vitest";
import type { HoleHistory, RoundBaseline, RoundBaselines } from "./personal-baseline";
import { buildRoundReport } from "./round-report";
import { buildRoundScorecard } from "./round-scorecard";
import {
  buildPersonalSummary,
  describeRank,
  formatStrokes,
  formatVsAverage,
  holeCallouts,
  personalHeadline,
  scoringOpportunities,
  worstHole,
} from "./round-story";
import type { Course, GolfRound, HoleMetrics } from "./types";

// Each nine is par 36.
const PARS = [4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 5, 4];
const ALL_PARS = Array<number>(18).fill(0);

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

/** A completed eighteen built from strokes over par, hole by hole. */
function round(id: string, toPars: number[]): GolfRound {
  return {
    id,
    courseId: COURSE.id,
    courseName: COURSE.name,
    location: COURSE.location,
    segment: "full18",
    tee: "White",
    courseRating: 72,
    courseSlope: 113,
    course: COURSE,
    startedAt: "2026-09-01T14:00:00.000Z",
    completedAt: "2026-09-01T18:00:00.000Z",
    status: "completed",
    scores: Object.fromEntries(toPars.map((toPar, index) => [index + 1, PARS[index] + toPar])),
    events: [],
  };
}

function withMetrics(base: GolfRound, byHole: Record<number, HoleMetrics>): GolfRound {
  return {
    ...base,
    events: Object.entries(byHole).map(([hole, metrics], index) => ({
      id: `event-${hole}`,
      at: new Date(Date.UTC(2026, 8, 1, 15, index)).toISOString(),
      source: "manual" as const,
      text: "",
      hole: Number(hole),
      metrics,
    })),
  };
}

/** Hole histories with your own average on each hole given. */
function averages(byHole: Record<number, number>, source: "hole" | "par-type" = "hole"): Map<number, HoleHistory> {
  return new Map(Object.entries(byHole).map(([hole, average]): [number, HoleHistory] => [
    Number(hole),
    { plays: 5, best: Math.floor(average), last: Math.round(average), baseline: { source, average, samples: 5, confidence: "solid" } },
  ]));
}

function baseline(kind: RoundBaseline["kind"], values: Partial<RoundBaseline> = {}): RoundBaseline {
  return { kind, rounds: 0, samples: 0, confidence: "building", average: null, delta: null, best: null, last: null, ...values };
}

function baselines(values: Partial<RoundBaselines> = {}): RoundBaselines {
  return {
    result: { total: 110, par: 67, toPar: 43, holes: 18 },
    course: baseline("course"),
    format: baseline("format"),
    pace: baseline("pace"),
    ...values,
  };
}

const AT_ARROWHEAD = baseline("course", { rounds: 3, samples: 3, confidence: "early", average: 114.2, delta: -4.2, best: 108, last: 112 });

describe("formatting", () => {
  it("signs differences from your average to one decimal", () => {
    expect([-1.14, 0.9, -0.04, 2].map(formatVsAverage)).toEqual(["-1.1", "+0.9", "0.0", "+2.0"]);
  });

  it("counts strokes in words, whichever way they went", () => {
    expect([4.2, -4, 1, 0.46].map(formatStrokes)).toEqual(["4.2 strokes", "4 strokes", "1 stroke", "0.5 strokes"]);
  });
});

describe("personalHeadline", () => {
  it("prefers your average on the same holes at this course", () => {
    const headline = personalHeadline(
      baselines({ course: AT_ARROWHEAD, format: baseline("format", { rounds: 6, samples: 6, confidence: "solid", average: 47, delta: -4 }) }),
      "Arrowhead",
    );
    expect(headline).toMatchObject({
      basis: "course",
      tone: "under",
      value: "-4.2",
      confidence: "early",
      title: "4.2 strokes better than your Arrowhead average",
      detail: "Average 114.2 over your last 3 rounds here · Best 108",
    });
  });

  it("calls anything within half a stroke normal", () => {
    const headline = personalHeadline(
      baselines({ course: baseline("course", { rounds: 3, samples: 3, confidence: "early", average: 110.3, delta: -0.3 }) }),
      "Arrowhead",
    );
    expect(headline).toMatchObject({ tone: "even", title: "Right on your Arrowhead average" });
  });

  it("uses your rounds of the same length when the course is new to you", () => {
    const headline = personalHeadline(
      baselines({
        course: baseline("course", { rounds: 1, samples: 1, last: 114 }),
        format: baseline("format", { rounds: 5, samples: 5, confidence: "solid", average: 40, delta: 3, best: 36 }),
      }),
      "Arrowhead",
    );
    expect(headline).toMatchObject({
      basis: "format",
      tone: "over",
      value: "+3.0",
      title: "3 strokes worse than your usual 18-hole round",
      detail: "Your 18-hole rounds average +40.0 vs par over the last 5 rounds · Best +36",
    });
  });

  it("falls back to your pace, in whole strokes", () => {
    const headline = personalHeadline(
      baselines({ pace: baseline("pace", { rounds: 3, samples: 3, confidence: "early", average: 52.3, delta: -9.3 }) }),
      "Arrowhead",
    );
    expect(headline).toMatchObject({ basis: "pace", value: "-9", title: "About 9 strokes better than your usual pace" });
  });

  it("says the baseline is building and offers only plain facts", () => {
    const headline = personalHeadline(
      baselines({ course: baseline("course", { rounds: 1, samples: 1, last: 114 }), pace: baseline("pace", { rounds: 1, samples: 1 }) }),
      "Arrowhead",
    );
    expect(headline).toEqual({
      basis: null,
      delta: null,
      tone: null,
      value: null,
      confidence: "building",
      title: "Building your baseline",
      detail: "4 strokes better than last time here (114). 2 more finished rounds unlock your average.",
    });
  });

  it("marks a first round as the start of the baseline", () => {
    expect(personalHeadline(baselines(), "Arrowhead").detail).toBe("This round starts your baseline. 3 finished rounds unlock your average.");
  });

  it("does not compare a round with gaps in it", () => {
    expect(personalHeadline(baselines({ result: null, course: AT_ARROWHEAD }), "Arrowhead")).toMatchObject({
      basis: null,
      title: "Finish every hole to compare",
    });
  });
});

describe("describeRank", () => {
  const options = { courseName: "Arrowhead", holes: 18 as const, later: false };

  it("celebrates a best", () => {
    expect(describeRank({ position: 1, of: 4, tied: false }, "course", options)).toBe("Your best round at Arrowhead yet (4 played)");
  });

  it("places the rest, and says so when later rounds exist", () => {
    expect(describeRank({ position: 3, of: 7, tied: false }, "format", options)).toBe("Your 3rd-best 18-hole round, out of 7");
    expect(describeRank({ position: 2, of: 5, tied: true }, "format", { ...options, later: true })).toBe(
      "Your 2nd-best 18-hole round at the time (tied), out of 5",
    );
    expect(describeRank({ position: 1, of: 3, tied: true }, "course", { ...options, later: true })).toBe(
      "Tied for your best round at Arrowhead at the time (3 played)",
    );
  });
});

describe("holeCallouts", () => {
  it("ranks holes by strokes against your average and leaves normal ones out", () => {
    // Par on every hole. Averages: hole 2 at 6.7 is -2.7, hole 1 at 5.8 is -1.8, hole 3 at 3.9 only -0.9;
    // holes 4 and 5 are a stroke worse than usual.
    const card = buildRoundScorecard({ round: round("r", ALL_PARS), handicapIndex: null, history: averages({ 1: 5.8, 2: 6.7, 3: 3.9, 4: 3, 5: 4 }) });
    const callouts = holeCallouts(card);
    expect(callouts.wentWell.map((line) => line.hole.number)).toEqual([2, 1]);
    expect(callouts.costYou.map((line) => line.hole.number)).toEqual([4, 5]);
    expect(callouts.compared).toBe(5);
  });

  it("keeps to three a side, putting your own holes ahead of borrowed averages on a tie", () => {
    const history = new Map([...averages({ 4: 6, 6: 6 }, "par-type"), ...averages({ 1: 6, 2: 6, 3: 5 })]);
    const card = buildRoundScorecard({ round: round("r", ALL_PARS), handicapIndex: null, history });
    expect(holeCallouts(card).wentWell.map((line) => line.hole.number)).toEqual([1, 2, 3]);
  });

  it("compares nothing without history", () => {
    expect(holeCallouts(buildRoundScorecard({ round: round("r", ALL_PARS), handicapIndex: null }))).toEqual({ wentWell: [], costYou: [], compared: 0 });
  });
});

describe("worstHole", () => {
  it("picks the hole furthest over your average", () => {
    const toPars = [...ALL_PARS];
    toPars[11] = 6; // hole 12: 10, usually 7.4
    toPars[14] = 4; // hole 15: 8, usually 6.5
    const card = buildRoundScorecard({ round: round("r", toPars), handicapIndex: null, history: averages({ 12: 7.4, 15: 6.5 }) });
    const worst = worstHole(card);
    expect(worst).toMatchObject({ basis: "average", line: { hole: { number: 12 }, score: 10 } });
    expect(worst?.delta).toBeCloseTo(2.6);
  });

  it("falls back to the worst hole against par, from triple bogey up", () => {
    const toPars = [...ALL_PARS];
    toPars[2] = 3;
    toPars[8] = 4;
    expect(worstHole(buildRoundScorecard({ round: round("r", toPars), handicapIndex: null }))).toMatchObject({
      basis: "par",
      delta: 4,
      line: { hole: { number: 9 } },
    });
  });

  it("finds nothing on a tidy round", () => {
    const toPars = [...ALL_PARS];
    toPars[0] = 2;
    expect(worstHole(buildRoundScorecard({ round: round("r", toPars), handicapIndex: null }))).toBeNull();
  });
});

describe("scoringOpportunities", () => {
  it("puts blow-up holes first when they cost the most", () => {
    // A real high-handicap eighteen: eight triples or worse, three doubles, six bogeys and a par.
    const toPars = [1, 1, 4, 1, 1, 4, 4, 0, 3, 3, 2, 6, 2, 1, 4, 1, 2, 3];
    const [top, ...rest] = scoringOpportunities(buildRoundReport(round("r", toPars)));
    expect(top).toMatchObject({
      kind: "blow-ups",
      strokes: 15,
      holes: [3, 6, 7, 9, 10, 12, 15, 18],
      detail: "8 holes at triple bogey or worse cost 15 strokes more than double bogeys would have.",
    });
    expect(rest.map((item) => [item.kind, item.strokes])).toEqual([["bogeys", 6], ["doubles", 3]]);
  });

  it("chooses from the round rather than a fixed rule", () => {
    // Ten bogeys and one double: bogeys into pars is worth the most.
    const toPars = ALL_PARS.map((_, index): number => (index < 10 ? 1 : 0));
    toPars[12] = 2;
    expect(scoringOpportunities(buildRoundReport(round("r", toPars)))[0]).toMatchObject({ kind: "bogeys", strokes: 10 });
  });

  it("counts tracked penalties and three-putts", () => {
    const base = round("r", ALL_PARS.map((_, index) => (index < 3 ? 2 : 0)));
    const tracked = withMetrics(base, { 1: { penaltyStrokes: 2 }, 2: { penaltyStrokes: 1 }, 5: { putts: 4 }, 6: { putts: 3 } });
    expect(scoringOpportunities(buildRoundReport(tracked)).map((item) => [item.kind, item.strokes])).toEqual([
      ["penalties", 3],
      ["three-putts", 3],
      ["doubles", 3],
    ]);
  });

  it("stays quiet when nothing is worth two strokes", () => {
    const toPars = [...ALL_PARS];
    toPars[0] = 2;
    toPars[5] = 1;
    expect(scoringOpportunities(buildRoundReport(round("r", toPars)))).toEqual([]);
  });

  it("breaks a tie toward the change a beginner can make soonest", () => {
    const toPars = [...ALL_PARS];
    toPars[0] = 4;
    toPars[3] = 2;
    toPars[4] = 2;
    expect(scoringOpportunities(buildRoundReport(round("r", toPars))).map((item) => item.kind)).toEqual(["blow-ups", "doubles"]);
  });
});

describe("buildPersonalSummary", () => {
  it("hands the caddy plain lines with the numbers in them", () => {
    const toPars = [...ALL_PARS];
    toPars[11] = 6;
    const card = buildRoundScorecard({ round: round("r", toPars), handicapIndex: null, history: averages({ 8: 5.8, 12: 7.4 }) });
    const summary = buildPersonalSummary({
      headline: personalHeadline(baselines({ course: AT_ARROWHEAD }), "Arrowhead"),
      card,
      callouts: holeCallouts(card),
      opportunity: null,
      ranks: ["Your best round at Arrowhead yet (4 played)"],
      trend: null,
    });
    expect(summary).toEqual({
      comparison: "4.2 strokes better than your Arrowhead average. Average 114.2 over your last 3 rounds here · Best 108",
      handicap: null,
      ranks: ["Your best round at Arrowhead yet (4 played)"],
      trend: null,
      holesBetter: ["Hole 8: 4 today vs your avg 5.8 (-1.8 vs you)"],
      holesWorse: ["Hole 12: 10 today vs your avg 7.4 (+2.6 vs you)"],
      biggestOpportunity: null,
    });
  });
});
