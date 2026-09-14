import { describe, expect, it } from "vitest";
import {
  buildRoundReport,
  buildSummaryInput,
  compareToPrevious,
  MAX_FACTS,
  previousCompletedRounds,
  roundSummaryFingerprint,
  scoreMix,
  scoredHoles,
  scoreType,
} from "./round-report";
import type { Course, GolfRound, HoleMetrics } from "./types";

// Front nine and back nine each par 36.
const PARS = [4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 5, 4];

const COURSE: Course = {
  id: "test-links-white",
  name: "Test Links",
  shortName: "Test Links",
  location: "Rochester, NY",
  tee: "White",
  rating: 70,
  slope: 120,
  par: 72,
  yards: 6000,
  sourceUrl: "",
  holes: PARS.map((par, index) => ({ number: index + 1, par, yards: 350, handicap: index + 1, suggestedClub: "", strategy: "" })),
};

/** A completed round built from strokes against par, hole by hole from hole 1. */
function round(id: string, toPars: number[], overrides: Partial<GolfRound> = {}): GolfRound {
  return {
    id,
    courseId: COURSE.id,
    courseName: COURSE.name,
    location: COURSE.location,
    segment: "full18",
    tee: "White",
    courseRating: 70,
    courseSlope: 120,
    course: COURSE,
    startedAt: "2026-09-01T14:00:00.000Z",
    completedAt: "2026-09-01T18:00:00.000Z",
    status: "completed",
    scores: Object.fromEntries(toPars.map((toPar, index) => [index + 1, PARS[index] + toPar])),
    events: [],
    ...overrides,
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

const ALL_PARS = Array(18).fill(0);
const texts = (facts: Array<{ text: string }>) => facts.map((fact) => fact.text);

describe("scoreType", () => {
  it("names every score against par", () => {
    expect(scoreType(3, 4)).toBe("birdie");
    expect(scoreType(4, 4)).toBe("par");
    expect(scoreType(5, 4)).toBe("bogey");
    expect(scoreType(6, 4)).toBe("double");
    expect(scoreType(7, 4)).toBe("triple");
  });

  it("folds anything better than a birdie into eagle", () => {
    expect(scoreType(2, 4)).toBe("eagle");
    expect(scoreType(1, 3)).toBe("eagle");
    expect(scoreType(2, 5)).toBe("eagle");
  });

  it("folds anything worse than a double into triple", () => {
    expect(scoreType(9, 4)).toBe("triple");
  });
});

describe("scoreMix", () => {
  it("counts each kind of score", () => {
    const toPars = [-2, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 2, 3];
    expect(scoreMix(scoredHoles(round("mix", toPars)))).toEqual({ eagle: 1, birdie: 2, par: 10, bogey: 3, double: 1, triple: 1 });
  });

  it("ignores holes with no score", () => {
    const partial = round("partial", ALL_PARS);
    delete partial.scores[18];
    expect(scoredHoles(partial)).toHaveLength(17);
  });

  it("previews an unsaved edit without touching the round", () => {
    const base = round("edit", ALL_PARS);
    expect(scoredHoles(base, { ...base.scores, 1: 3 })[0].type).toBe("birdie");
    expect(scoredHoles(base)[0].type).toBe("par");
  });
});

describe("what went well", () => {
  it("names the holes where the birdies came", () => {
    const toPars = [...ALL_PARS];
    toPars[3] = -1;
    toPars[10] = -1;
    expect(texts(buildRoundReport(round("birdies", toPars)).wentWell)).toContain("2 birdies on holes 4 and 11");
  });

  it("puts an eagle above everything else", () => {
    const toPars = [...ALL_PARS];
    toPars[6] = -2;
    toPars[2] = -1;
    expect(buildRoundReport(round("eagle", toPars)).wentWell[0].key).toBe("eagles");
  });

  it("credits a clean card with no doubles", () => {
    expect(texts(buildRoundReport(round("clean", ALL_PARS)).wentWell)).toContain("Not a single double bogey all round");
  });

  it("does not credit a clean card when there was a double", () => {
    const toPars = [...ALL_PARS];
    toPars[0] = 2;
    expect(buildRoundReport(round("dirty", toPars)).wentWell.map((fact) => fact.key)).not.toContain("no-doubles");
  });

  it("finds the longest run of par or better", () => {
    const toPars = [1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1];
    const facts = buildRoundReport(round("streak", toPars)).wentWell;
    expect(texts(facts)).toContain("4 straight holes at par or better (5–8)");
  });

  it("counts bounce-backs only straight after a bogey or worse", () => {
    // 1->2, 3->4 and 6->7 each answer a bogey or worse with par or better.
    const toPars = [1, 0, 2, -1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(texts(buildRoundReport(round("bounce", toPars)).wentWell)).toContain(
      "Bounced back with par or better 3 times after a bogey or worse",
    );
  });

  it("shows at most a handful of facts, heaviest first", () => {
    const toPars = [-2, -1, 0, 0, 0, 0, -1, 0, 1, 0, 0, 0, -1, 0, 0, 0, 0, 0];
    const busy = withMetrics(round("busy", toPars), { 1: { putts: 1, penaltyStrokes: 0 }, 2: { putts: 1 }, 3: { putts: 1 } });
    const facts = buildRoundReport(busy).wentWell;
    expect(facts.length).toBeLessThanOrEqual(MAX_FACTS);
    expect(facts.map((fact) => fact.weight)).toEqual([...facts.map((fact) => fact.weight)].sort((left, right) => right - left));
  });
});

describe("what cost you", () => {
  it("adds up what the blow-ups cost", () => {
    const toPars = [...ALL_PARS];
    toPars[1] = 2;
    toPars[8] = 2;
    toPars[13] = 3;
    expect(texts(buildRoundReport(round("blowups", toPars)).costYou)).toContain(
      "3 doubles or worse on holes 2, 9 and 14, +7 on those holes alone",
    );
  });

  it("calls out the single worst hole", () => {
    // Hole 8 is a par 4 on this card; an 8 there is +4.
    const toPars = [...ALL_PARS];
    toPars[7] = 4;
    expect(texts(buildRoundReport(round("worst", toPars)).costYou)).toContain("Hole 8: 8 on a par 4");
  });

  it("spots a run of holes over par", () => {
    const toPars = [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 1, 1, 0, 0, 0, 0];
    expect(texts(buildRoundReport(round("slide", toPars)).costYou)).toContain("5 straight holes over par (10–14)");
  });

  it("flags a big gap between the nines", () => {
    const slowStart = [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
    expect(texts(buildRoundReport(round("slow", slowStart)).costYou)).toContain("Slow start: +8 on the front, +1 on the back");
  });

  it("only compares nines on an eighteen-hole round", () => {
    const nine = round("nine", [1, 1, 1, 1, 1, 1, 1, 1, 1], { segment: "front9" });
    expect(buildRoundReport(nine).costYou.map((fact) => fact.key)).not.toContain("nines");
  });
});

describe("tracked stats", () => {
  it("says nothing about stats that were never tracked", () => {
    const report = buildRoundReport(round("untracked", ALL_PARS));
    const keys = [...report.wentWell, ...report.costYou].map((fact) => fact.key);
    for (const key of ["fairways", "one-putts", "three-putts", "penalties", "no-penalties"]) expect(keys).not.toContain(key);
    expect(report.rates.fairwayRate).toBeNull();
    expect(report.rates.puttsPerHole).toBeNull();
    expect(report.rates.penaltiesPerHole).toBeNull();
  });

  it("reports penalty strokes that were counted", () => {
    const tracked = withMetrics(round("penalties", ALL_PARS), { 3: { penaltyStrokes: 2 } });
    expect(texts(buildRoundReport(tracked).costYou)).toContain("2 penalty strokes handed away");
  });

  it("only praises a penalty-free round when penalties were counted on most holes", () => {
    const fewTracked = withMetrics(round("few", ALL_PARS), { 1: { penaltyStrokes: 0 } });
    expect(buildRoundReport(fewTracked).wentWell.map((fact) => fact.key)).not.toContain("no-penalties");

    const allTracked = withMetrics(round("all", ALL_PARS), Object.fromEntries(PARS.map((_par, index) => [index + 1, { penaltyStrokes: 0 }])));
    expect(buildRoundReport(allTracked).wentWell.map((fact) => fact.key)).toContain("no-penalties");
  });

  it("finds three-putts and keeps the rate against putted holes only", () => {
    const tracked = withMetrics(round("putting", ALL_PARS), { 6: { putts: 3 }, 12: { putts: 3 }, 1: { putts: 2 }, 2: { putts: 2 } });
    const report = buildRoundReport(tracked);
    expect(texts(report.costYou)).toContain("2 three-putts on holes 6 and 12");
    expect(report.rates.threePuttRate).toBeCloseTo(0.5, 9);
    expect(report.rates.puttsPerHole).toBeCloseTo(2.5, 9);
  });

  it("praises fairways when most were hit and flags them when most were missed", () => {
    const hits = withMetrics(round("hits", ALL_PARS), { 1: { fairway: "hit" }, 2: { fairway: "hit" }, 4: { fairway: "miss" } });
    expect(texts(buildRoundReport(hits).wentWell)).toContain("Hit 2 of 3 fairways (67%)");

    const misses = withMetrics(round("misses", ALL_PARS), { 1: { fairway: "miss" }, 2: { fairway: "miss" }, 4: { fairway: "hit" } });
    expect(texts(buildRoundReport(misses).costYou)).toContain("Missed 2 of 3 fairways");
  });
});

describe("previousCompletedRounds", () => {
  const current = round("current", ALL_PARS, { startedAt: "2026-09-10T14:00:00.000Z", completedAt: "2026-09-10T18:00:00.000Z" });
  const older = round("older", ALL_PARS, { startedAt: "2026-09-01T14:00:00.000Z", completedAt: "2026-09-01T18:00:00.000Z" });
  const oldest = round("oldest", ALL_PARS, { startedAt: "2026-08-01T14:00:00.000Z", completedAt: "2026-08-01T18:00:00.000Z" });
  const later = round("later", ALL_PARS, { startedAt: "2026-09-11T14:00:00.000Z", completedAt: "2026-09-11T18:00:00.000Z" });
  const active = round("active", ALL_PARS, { startedAt: "2026-09-05T14:00:00.000Z", completedAt: undefined, status: "active" });

  it("keeps only completed rounds played earlier, newest first", () => {
    const previous = previousCompletedRounds([oldest, later, current, active, older], current);
    expect(previous.map((item) => item.id)).toEqual(["older", "oldest"]);
  });

  it("respects the limit", () => {
    expect(previousCompletedRounds([oldest, older], current, 1).map((item) => item.id)).toEqual(["older"]);
  });
});

describe("compareToPrevious", () => {
  it("reports nothing without earlier rounds", () => {
    expect(compareToPrevious(buildRoundReport(round("first", ALL_PARS)), [])).toEqual({ previousCount: 0, improving: [], slipping: [] });
  });

  it("knows which direction is better for each metric", () => {
    const now = buildRoundReport(round("now", ALL_PARS));
    const before = buildRoundReport(round("before", Array(18).fill(1)));
    const comparison = compareToPrevious(now, [before]);
    expect(comparison.improving.map((delta) => delta.key)).toContain("toParPerHole");
    expect(comparison.improving.map((delta) => delta.key)).toContain("parsOrBetterRate");
    expect(comparison.slipping).toEqual([]);
  });

  it("puts a worse stat under slipping", () => {
    const now = withMetrics(round("now", ALL_PARS), { 1: { fairway: "miss" }, 2: { fairway: "miss" }, 4: { fairway: "hit" } });
    const before = withMetrics(round("before", ALL_PARS), { 1: { fairway: "hit" }, 2: { fairway: "hit" }, 4: { fairway: "hit" } });
    expect(compareToPrevious(buildRoundReport(now), [buildRoundReport(before)]).slipping.map((delta) => delta.key)).toContain("fairwayRate");
  });

  it("ignores changes too small to mean anything", () => {
    const toPars = [...ALL_PARS];
    toPars[0] = 1;
    const comparison = compareToPrevious(buildRoundReport(round("now", toPars)), [buildRoundReport(round("before", ALL_PARS))]);
    expect(comparison.slipping.map((delta) => delta.key)).not.toContain("toParPerHole");
  });

  it("never compares a stat that was not tracked in both", () => {
    const now = withMetrics(round("now", ALL_PARS), { 1: { putts: 1 } });
    const comparison = compareToPrevious(buildRoundReport(now), [buildRoundReport(round("before", ALL_PARS))]);
    expect([...comparison.improving, ...comparison.slipping].map((delta) => delta.key)).not.toContain("puttsPerHole");
  });

  it("leaves out rounds too short to compare", () => {
    const stub = round("stub", [0, 0, 0], { segment: "front9" });
    expect(compareToPrevious(buildRoundReport(round("now", ALL_PARS)), [buildRoundReport(stub)]).previousCount).toBe(0);
  });
});

describe("buildSummaryInput", () => {
  it("hands the model the facts and the history, and nothing untracked", () => {
    const now = round("now", ALL_PARS, { startedAt: "2026-09-10T14:00:00.000Z", completedAt: "2026-09-10T18:00:00.000Z" });
    const before = round("before", Array(18).fill(1));
    const report = buildRoundReport(now);
    const input = buildSummaryInput(now, report, compareToPrevious(report, [buildRoundReport(before)]));

    expect(input.score).toEqual({ total: 72, par: 72, toPar: "E", holes: 18 });
    expect(input.scoreMix.Pars).toBe(18);
    expect(input.history.previousRounds).toBe(1);
    expect(input.history.improving.some((line) => line.startsWith("Score against par"))).toBe(true);
    expect(JSON.stringify(input).toLowerCase()).not.toContain("fairway");
    expect(JSON.stringify(input).toLowerCase()).not.toContain("putt");
  });
});

describe("roundSummaryFingerprint", () => {
  const base = round("fp", ALL_PARS);

  it("does not depend on the order scores were stored in", () => {
    const reordered = { ...base, scores: Object.fromEntries(Object.entries(base.scores).reverse()) };
    expect(roundSummaryFingerprint(reordered, [])).toBe(roundSummaryFingerprint(base, []));
  });

  it("changes when a score is edited", () => {
    expect(roundSummaryFingerprint({ ...base, scores: { ...base.scores, 5: 9 } }, [])).not.toBe(roundSummaryFingerprint(base, []));
  });

  it("changes when a round it was compared against is edited", () => {
    const earlier = round("earlier", ALL_PARS);
    const edited = { ...earlier, scores: { ...earlier.scores, 1: 7 } };
    expect(roundSummaryFingerprint(base, [edited])).not.toBe(roundSummaryFingerprint(base, [earlier]));
  });

  it("changes when a tracked stat is added", () => {
    expect(roundSummaryFingerprint(withMetrics(base, { 1: { putts: 2 } }), [])).not.toBe(roundSummaryFingerprint(base, []));
  });
});

describe("a rough day still has something good", () => {
  it("names the best hole when no hole reached par", () => {
    // The reported case: nothing at par, one bogey. That bogey was the best hole of the day.
    const toPars = Array(18).fill(2);
    toPars[6] = 1;
    expect(texts(buildRoundReport(round("rough", toPars)).wentWell)).toContain("Best of the day: a bogey on hole 7");
  });

  it("never leaves the list empty once holes are scored", () => {
    expect(buildRoundReport(round("uniform", Array(18).fill(3))).wentWell.length).toBeGreaterThan(0);
    expect(buildRoundReport(round("nine", Array(9).fill(2), { segment: "front9" })).wentWell.length).toBeGreaterThan(0);
  });

  it("counts bogeys or better when pars were scarce", () => {
    const toPars = [1, 1, 2, 1, 2, 1, 1, 2, 1, 0, 1, 2, 1, 1, 2, 1, 1, 2];
    expect(texts(buildRoundReport(round("bogeys", toPars)).wentWell)).toContain("12 of 18 holes at bogey or better");
  });

  it("does not bother counting bogeys on a round full of pars", () => {
    const toPars = [...ALL_PARS];
    toPars[0] = 1;
    expect(buildRoundReport(round("tidy", toPars)).wentWell.map((fact) => fact.key)).not.toContain("bogey-or-better");
  });

  it("does not name a best hole when a hole reached par", () => {
    const toPars = Array(18).fill(2);
    toPars[3] = 0;
    expect(buildRoundReport(round("one-par", toPars)).wentWell.map((fact) => fact.key)).not.toContain("best-hole");
  });
});

describe("judged against your own par", () => {
  // This card is rated 70 with a 120 slope, so a 20 index gives 19 strokes: one on every hole
  // and a second on the hardest. Bogey golf is then a stroke better than your handicap target.
  it("credits beating your handicap", () => {
    const report = buildRoundReport(round("bogey-golf", Array(18).fill(1)), undefined, { handicapIndex: 20 });
    expect(texts(report.wentWell)).toContain("Beat your handicap by 1 stroke");
    expect(texts(report.wentWell)).toContain("18 of 18 holes at or under your handicap target");
  });

  it("says nothing about your handicap target without a handicap", () => {
    const keys = buildRoundReport(round("bogey-golf", Array(18).fill(1))).wentWell.map((fact) => fact.key);
    expect(keys).not.toContain("handicap-target");
    expect(keys).not.toContain("beat-handicap");
  });

  it("does not credit beating a handicap that was not beaten", () => {
    const keys = buildRoundReport(round("rough", Array(18).fill(3)), undefined, { handicapIndex: 5 }).wentWell.map((fact) => fact.key);
    expect(keys).not.toContain("beat-handicap");
  });
});


describe("a few good holes are named, not counted", () => {
  it("names a lone par instead of calling it 1 of 18", () => {
    const toPars = Array(18).fill(2);
    toPars[3] = 0;
    const facts = texts(buildRoundReport(round("one-par", toPars)).wentWell);
    expect(facts).toContain("A par on hole 4");
    expect(facts.some((text) => text.includes("of 18 holes at par or better"))).toBe(false);
  });

  it("names two pars together", () => {
    const toPars = Array(18).fill(2);
    toPars[3] = 0;
    toPars[10] = 0;
    expect(texts(buildRoundReport(round("two-pars", toPars)).wentWell)).toContain("Pars on holes 4 and 11");
  });

  it("counts once there are enough to count", () => {
    const toPars = Array(18).fill(2);
    toPars[3] = 0;
    toPars[10] = 0;
    toPars[14] = 0;
    expect(texts(buildRoundReport(round("three-pars", toPars)).wentWell)).toContain("3 of 18 holes at par or better");
  });

  it("lets a birdie speak for itself", () => {
    const toPars = Array(18).fill(2);
    toPars[2] = -1;
    const report = buildRoundReport(round("birdie-only", toPars));
    expect(texts(report.wentWell)).toContain("A birdie on hole 3");
    expect(report.wentWell.map((fact) => fact.key)).not.toContain("pars-or-better");
  });

  it("says the one good hole once, and what it meant for you", () => {
    // The reported case: one bogey and the rest well over. A 20 index gives the hardest hole
    // two strokes, so that bogey was a stroke better than your handicap target.
    const toPars = Array(18).fill(3);
    toPars[0] = 1;
    const report = buildRoundReport(round("one-bogey", toPars), undefined, { handicapIndex: 20 });
    expect(texts(report.wentWell)).toEqual(["Best of the day: a bogey on hole 1, a stroke under your handicap target"]);
  });

  it("says right on your handicap target when the best hole matched it", () => {
    const toPars = Array(18).fill(3);
    toPars[6] = 1;
    const report = buildRoundReport(round("one-bogey", toPars), undefined, { handicapIndex: 20 });
    expect(texts(report.wentWell)).toContain("Best of the day: a bogey on hole 7, right on your handicap target");
  });

  it("leaves the credit off when the best hole was still over your handicap target", () => {
    // A 5 index gives three strokes here, on holes 1 to 3. Hole 7 gets none.
    const toPars = Array(18).fill(3);
    toPars[6] = 1;
    const report = buildRoundReport(round("one-bogey", toPars), undefined, { handicapIndex: 5 });
    expect(texts(report.wentWell)).toContain("Best of the day: a bogey on hole 7");
  });
});

describe("the summary fingerprint follows the personal story", () => {
  it("changes when what the baseline says changes", () => {
    const base = round("fingerprint", ALL_PARS);
    const personal = {
      comparison: "Building your baseline. This round starts your baseline.",
      handicap: null,
      ranks: [],
      trend: null,
      holesBetter: [],
      holesWorse: [],
      biggestOpportunity: null,
    };
    expect(roundSummaryFingerprint(base, [], personal)).not.toBe(
      roundSummaryFingerprint(base, [], { ...personal, comparison: "2 strokes better than your usual 18-hole round." }),
    );
    expect(roundSummaryFingerprint(base, [])).toBe(roundSummaryFingerprint(base, [], undefined));
  });
});
