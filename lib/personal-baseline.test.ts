import { describe, expect, it } from "vitest";
import {
  buildHoleHistory,
  buildRoundBaselines,
  completeResult,
  confidenceFor,
  courseProgress,
  describeTrend,
  formatProgress,
  historyBefore,
  playedLater,
  rankLabel,
  rankRound,
  scoringTrend,
} from "./personal-baseline";
import type { Course, GolfRound, RoundSegment } from "./types";

// Test Links: each nine is par 36.
const LINKS_PARS = [4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 5, 4];
// Other Park: par 3s open each nine, so its par-3 holes are easy to pick out. Each nine is par 36.
const PARK_PARS = [3, 3, 3, 4, 4, 4, 5, 5, 5, 3, 3, 3, 4, 4, 4, 5, 5, 5];

function course(id: string, name: string, location: string, tee: string, pars: number[]): Course {
  return {
    id,
    name,
    shortName: name,
    location,
    tee,
    rating: 70,
    slope: 120,
    par: pars.reduce((total, par) => total + par, 0),
    yards: 6000,
    sourceUrl: "",
    holes: pars.map((par, index) => ({ number: index + 1, par, yards: 350, handicap: index + 1, suggestedClub: "", strategy: "" })),
  };
}

const LINKS = course("test-links-white", "Test Links", "Rochester, NY", "White", LINKS_PARS);
const LINKS_RED = course("test-links-red", "Test Links", "Rochester, New York", "Red", LINKS_PARS);
const PARK = course("other-park-white", "Other Park", "Buffalo, NY", "White", PARK_PARS);

/** A round built from strokes over par, hole by hole from the first hole of its segment. `day` orders rounds. */
function played(
  id: string,
  day: number,
  where: Course,
  segment: RoundSegment,
  toPars: number[],
  status: GolfRound["status"] = "completed",
): GolfRound {
  const first = segment === "back9" ? 10 : 1;
  const at = new Date(Date.UTC(2026, 7, day, 17)).toISOString();
  return {
    id,
    courseId: where.id,
    courseName: where.name,
    location: where.location,
    segment,
    tee: where.tee,
    courseRating: where.rating,
    courseSlope: where.slope,
    course: where,
    startedAt: at,
    completedAt: status === "completed" ? at : undefined,
    status,
    scores: Object.fromEntries(toPars.map((toPar, index) => [first + index, where.holes[first + index - 1].par + toPar])),
    events: [],
  };
}

const nine = (toPar: number) => Array<number>(9).fill(toPar);
const eighteen = (toPar: number) => Array<number>(18).fill(toPar);
/** A nine `base` over par on every hole except the holes given. */
const nineWith = (base: number, holes: Record<number, number>) => nine(base).map((value, index) => holes[index + 1] ?? value);
/** Strokes over par for a round, spread across its holes as evenly as whole strokes allow. */
function spread(total: number, holes: number): number[] {
  const base = Math.floor(total / holes);
  return Array.from({ length: holes }, (_, index) => base + (index < total - base * holes ? 1 : 0));
}

describe("confidenceFor", () => {
  it("builds until three scores, then reads early, solid and strong", () => {
    expect([0, 2, 3, 4, 5, 9, 10].map(confidenceFor)).toEqual(["building", "building", "early", "early", "solid", "solid", "strong"]);
  });
});

describe("rankLabel", () => {
  it("says best, then ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(rankLabel)).toEqual([
      "best", "2nd-best", "3rd-best", "4th-best", "11th-best", "12th-best", "13th-best", "21st-best", "22nd-best",
    ]);
  });
});

describe("buildHoleHistory", () => {
  const first = played("first", 1, LINKS, "front9", nineWith(1, { 1: 2 })); // hole 1: 6
  const second = played("second", 2, LINKS, "front9", nineWith(1, { 1: 3 })); // 7
  const third = played("third", 3, LINKS, "front9", nineWith(1, { 1: 1 })); // 5
  const today = played("today", 4, LINKS, "front9", nine(1));
  const later = played("later", 5, LINKS, "front9", nineWith(1, { 1: -1 })); // 3, but after today

  it("averages a hole from the rounds before this one", () => {
    const hole = buildHoleHistory(historyBefore([first, second, third, today, later], today), today).get(1);
    expect(hole).toEqual({ plays: 3, best: 5, last: 5, baseline: { source: "hole", average: 6, samples: 3, confidence: "early" } });
  });

  it("claims no average from a single earlier round", () => {
    expect(buildHoleHistory(historyBefore([first, today], today), today).get(1)).toEqual({ plays: 1, best: 6, last: 6, baseline: null });
  });

  it("borrows your average for holes of the same par until a hole has three plays", () => {
    // Two rounds at another course: its three par 3s at +2, then at +1.
    const parkOne = played("park-1", 1, PARK, "front9", nineWith(0, { 1: 2, 2: 2, 3: 2 }));
    const parkTwo = played("park-2", 2, PARK, "front9", nineWith(0, { 1: 1, 2: 1, 3: 1 }));
    // Hole 3 at Test Links is a par 3 you have never played.
    expect(buildHoleHistory(historyBefore([parkOne, parkTwo, today], today), today).get(3)).toEqual({
      plays: 0,
      best: null,
      last: null,
      baseline: { source: "par-type", average: 4.5, samples: 6, confidence: "early" },
    });
  });

  it("needs more than one round before borrowing", () => {
    const park = played("park", 1, PARK, "full18", eighteen(1)); // six par 3s, but one round
    expect(buildHoleHistory(historyBefore([park, today], today), today).get(3)?.baseline).toBeNull();
  });

  it("counts the same course from another tee as the same holes", () => {
    const red = [1, 2, 3].map((day) => played(`red-${day}`, day, LINKS_RED, "front9", nine(2)));
    expect(buildHoleHistory(historyBefore([...red, today], today), today).get(1)?.baseline).toMatchObject({ source: "hole", average: 6, samples: 3 });
  });

  it("does not count a hole whose par is different", () => {
    const changed = course("test-links-new", "Test Links", "Rochester, NY", "White", [5, ...LINKS_PARS.slice(1)]);
    const rounds = [1, 2, 3].map((day) => played(`changed-${day}`, day, changed, "front9", nine(0)));
    const history = buildHoleHistory(historyBefore([...rounds, today], today), today);
    expect(history.get(1)?.plays).toBe(0);
    expect(history.get(2)?.plays).toBe(3);
  });

  it("follows improvement by averaging only your last ten plays", () => {
    const old = [1, 2].map((day) => played(`old-${day}`, day, LINKS, "front9", nineWith(1, { 1: 5 }))); // hole 1: 9
    const recent = Array.from({ length: 10 }, (_, index) => played(`recent-${index}`, 3 + index, LINKS, "front9", nineWith(1, { 1: 1 }))); // 5
    const now = played("now", 20, LINKS, "front9", nine(1));
    expect(buildHoleHistory(historyBefore([...old, ...recent, now], now), now).get(1)).toMatchObject({
      plays: 12,
      best: 5,
      last: 5,
      baseline: { source: "hole", average: 5, samples: 10, confidence: "strong" },
    });
  });

  it("ignores a round still in progress", () => {
    const active = played("active", 3, LINKS, "front9", nine(0), "active");
    expect(buildHoleHistory(historyBefore([first, second, active, today], today), today).get(1)?.plays).toBe(2);
  });
});

describe("completeResult", () => {
  it("needs every hole of the nine or eighteen", () => {
    const round = played("r", 1, LINKS, "full18", eighteen(0));
    expect(completeResult(round)).toEqual({ total: 72, par: 72, toPar: 0, holes: 18 });
    delete round.scores[18];
    expect(completeResult(round)).toBeNull();
  });
});

describe("buildRoundBaselines", () => {
  it("compares with your rounds on the same holes at this course, by strokes", () => {
    const earlier = [3, 2, 4].map((toPar, index) => played(`links-${index}`, index + 1, LINKS, "front9", nine(toPar))); // 63, 54, 72
    const backNine = played("links-back", 4, LINKS, "back9", nine(0));
    const today = played("today", 5, LINKS, "front9", nine(2)); // 54
    const { result, course: here } = buildRoundBaselines(historyBefore([...earlier, backNine, today], today), today);
    expect(result).toEqual({ total: 54, par: 36, toPar: 18, holes: 9 });
    expect(here).toEqual({ kind: "course", rounds: 3, samples: 3, confidence: "early", average: 63, delta: -9, best: 54, last: 72 });
  });

  it("compares eighteens with eighteens anywhere, by strokes over par", () => {
    const earlier = [2, 1, 3].map((perHole, index) => played(`park-${index}`, index + 1, PARK, "full18", eighteen(perHole))); // +36, +18, +54
    const aNine = played("a-nine", 4, LINKS, "front9", nine(5));
    const today = played("today", 5, LINKS, "full18", eighteen(1)); // +18
    const { course: here, format } = buildRoundBaselines(historyBefore([...earlier, aNine, today], today), today);
    expect(format).toEqual({ kind: "format", rounds: 3, samples: 3, confidence: "early", average: 36, delta: -18, best: 18, last: 54 });
    expect(here).toMatchObject({ rounds: 0, average: null, delta: null, confidence: "building" });
  });

  it("falls back to your pace across nines and eighteens", () => {
    const history = [
      played("nine-1", 1, LINKS, "front9", nine(1)), // +9
      played("nine-2", 2, PARK, "back9", nine(1)), // +9
      played("eighteen", 3, PARK, "full18", eighteen(2)), // +36
    ];
    const today = played("today", 4, LINKS, "back9", nine(1)); // +9
    const { format, pace } = buildRoundBaselines(historyBefore([...history, today], today), today);
    expect(format).toMatchObject({ rounds: 2, average: null });
    // 54 over par across 36 holes is 1.5 a hole, or 13.5 over a nine.
    expect(pace).toMatchObject({ kind: "pace", rounds: 3, samples: 3, confidence: "early", average: 13.5, delta: -4.5 });
  });

  it("keeps its averages to your last ten rounds", () => {
    const old = [1, 2].map((day) => played(`old-${day}`, day, LINKS, "front9", nine(5)));
    const recent = Array.from({ length: 10 }, (_, index) => played(`recent-${index}`, 3 + index, LINKS, "front9", nine(1)));
    const today = played("today", 20, LINKS, "front9", nine(1));
    expect(buildRoundBaselines(historyBefore([...old, ...recent, today], today), today).course).toMatchObject({
      rounds: 12,
      samples: 10,
      confidence: "strong",
      average: 45,
      delta: 0,
    });
  });

  it("compares nothing for a round with an unscored hole", () => {
    const earlier = [1, 2, 3].map((day) => played(`e-${day}`, day, LINKS, "front9", nine(1)));
    const today = played("today", 4, LINKS, "front9", nine(1));
    delete today.scores[9];
    const baselines = buildRoundBaselines(historyBefore([...earlier, today], today), today);
    expect(baselines.result).toBeNull();
    expect(baselines.course.delta).toBeNull();
    expect(baselines.pace.delta).toBeNull();
  });

  it("follows an unsaved correction", () => {
    const earlier = [1, 2, 3].map((day) => played(`e-${day}`, day, LINKS, "front9", nine(1)));
    const today = played("today", 4, LINKS, "front9", nine(1));
    const fixed = { ...today.scores, 1: today.scores[1] - 2 };
    expect(buildRoundBaselines(historyBefore([...earlier, today], today), today, fixed).course.delta).toBe(-2);
  });
});

describe("rankRound", () => {
  const earlier = [3, 2, 4].map((toPar, index) => played(`links-${index}`, index + 1, LINKS, "front9", nine(toPar))); // 63, 54, 72

  it("ranks among your rounds up to and including this one", () => {
    const today = played("today", 5, LINKS, "front9", nine(3)); // 63: beaten only by the 54
    expect(rankRound(historyBefore([...earlier, today], today), today)).toEqual({
      course: { position: 2, of: 4, tied: true },
      format: { position: 2, of: 4, tied: true },
    });
  });

  it("waits for three rounds before ranking", () => {
    const today = played("today", 5, LINKS, "front9", nine(1));
    expect(rankRound(historyBefore([earlier[0], today], today), today)).toEqual({ course: null, format: null });
  });
});

describe("scoringTrend", () => {
  const series = (totals: number[], holes: 9 | 18 = 18) =>
    totals.map((toPar, index) =>
      played(`s-${index}`, index + 1, holes === 18 ? LINKS : PARK, holes === 18 ? "full18" : "front9", spread(toPar, holes)));

  it("reads an improving run of eighteens", () => {
    const trend = scoringTrend(series([30, 28, 25, 24, 20]), { holes: 18 });
    expect(trend).toMatchObject({ direction: "improving", change: -9.6, needed: 0 });
    expect(trend.points.map((point) => point.toPar)).toEqual([30, 28, 25, 24, 20]);
    expect(describeTrend(trend)).toBe("Trending better: about 10 strokes lower across your last five 18-hole rounds.");
  });

  it("calls small moves steady", () => {
    const trend = scoringTrend(series([20, 21, 20, 21, 20]), { holes: 18 });
    expect(trend.direction).toBe("steady");
    expect(describeTrend(trend)).toBe("Holding steady across your last five 18-hole rounds.");
  });

  it("reads scores creeping up", () => {
    const trend = scoringTrend(series([20, 22, 24, 26]), { holes: 18 });
    expect(trend.direction).toBe("worsening");
    expect(describeTrend(trend)).toBe("Scores have crept up about 6 strokes across your last four 18-hole rounds.");
  });

  it("claims nothing when the fit and the halves disagree", () => {
    // The fit rises 3.2 strokes, but the last two rounds average the same as the first two.
    const trend = scoringTrend(series([20, 34, 25, 26, 28]), { holes: 18 });
    expect(trend.direction).toBe("mixed");
    expect(describeTrend(trend)).toBe("Up and down across your last five 18-hole rounds, with no clear trend yet.");
  });

  it("uses a lower bar for nines", () => {
    expect(scoringTrend(series([10, 9, 8, 8], 9), { holes: 9 }).direction).toBe("improving");
  });

  it("says how many more rounds it needs", () => {
    const trend = scoringTrend(series([20, 22]), { holes: 18 });
    expect(trend).toMatchObject({ direction: null, change: null, needed: 2 });
    expect(describeTrend(trend)).toBe("Play two more 18-hole rounds to see which way your scores are heading.");
  });

  it("stops at the round it is drawn through, and marks it", () => {
    const rounds = series([30, 28, 25, 24, 20]);
    const trend = scoringTrend(rounds, { holes: 18, through: rounds[2] });
    expect(trend.points.map((point) => [point.toPar, point.current])).toEqual([[30, false], [28, false], [25, true]]);
  });

  it("only counts rounds of the length asked for", () => {
    const rounds = [...series([30, 28, 25, 24]), played("a-nine", 9, LINKS, "front9", nine(1))];
    expect(scoringTrend(rounds, { holes: 18 }).points).toHaveLength(4);
  });
});

describe("courseProgress", () => {
  it("groups rounds on the same holes at a course, other tees included, once there are two", () => {
    const rounds = [
      played("w-1", 1, LINKS, "front9", nine(3)), // 63
      played("r-2", 2, LINKS_RED, "front9", nine(2)), // 54
      played("w-3", 3, LINKS, "front9", nine(4)), // 72
      played("back", 4, LINKS, "back9", nine(1)),
      played("park-1", 5, PARK, "full18", eighteen(1)), // 90
      played("park-2", 6, PARK, "full18", eighteen(2)), // 108
    ];
    const progress = courseProgress(rounds);
    expect(progress.map((item) => [item.courseName, item.segment, item.rounds])).toEqual([
      ["Test Links", "front9", 3],
      ["Other Park", "full18", 2],
    ]);
    expect(progress[0]).toMatchObject({ average: 63, best: 54, last: { roundId: "w-3", total: 72 }, lastVsAverage: null, confidence: "early" });
    expect(progress[1]).toMatchObject({ average: null, best: 90 });
  });

  it("compares your latest round with the rounds there before it", () => {
    const rounds = [3, 2, 4, 1].map((toPar, index) => played(`l-${index}`, index + 1, LINKS, "front9", nine(toPar))); // 63, 54, 72, 45
    expect(courseProgress(rounds)[0]).toMatchObject({ rounds: 4, average: 58.5, lastVsAverage: -18 });
  });
});

describe("formatProgress", () => {
  it("summarises your rounds of one length", () => {
    const rounds = [2, 1, 3].map((perHole, index) => played(`e-${index}`, index + 1, PARK, "full18", eighteen(perHole)));
    expect(formatProgress(rounds, 18)).toMatchObject({
      holes: 18,
      rounds: 3,
      lastFive: 36,
      lastTen: null,
      best: { roundId: "e-1", total: 90, toPar: 18 },
    });
    expect(formatProgress(rounds, 9)).toMatchObject({ rounds: 0, lastFive: null, best: null });
  });

  it("waits for three rounds before averaging, and adds a ten-round average past five", () => {
    expect(formatProgress([1, 2].map((day) => played(`e-${day}`, day, PARK, "full18", eighteen(1))), 18).lastFive).toBeNull();
    const many = [1, 1, 1, 1, 1, 2, 2].map((perHole, index) => played(`m-${index}`, index + 1, PARK, "full18", eighteen(perHole)));
    // Newest first: +36, +36, +18, +18, +18, then +18, +18.
    expect(formatProgress(many, 18)).toMatchObject({ lastFive: 25.2, lastTen: (36 * 2 + 18 * 5) / 7 });
  });
});

describe("playedLater", () => {
  it("knows whether a round was finished after this one", () => {
    const early = played("early", 1, LINKS, "front9", nine(1));
    const late = played("late", 2, LINKS, "front9", nine(1));
    expect(playedLater([early, late], early)).toBe(true);
    expect(playedLater([early, late], late)).toBe(false);
  });
});
