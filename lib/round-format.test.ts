import { describe, expect, it } from "vitest";
import {
  bestByFormat,
  describeFormatCounts,
  formatLabel,
  litHalves,
  nineBarHeights,
  pacePerHole,
  paceHeights,
  roundFormat,
  roundNines,
  shortFormatLabel,
} from "./round-format";
import type { Course, GolfRound, RoundSegment } from "./types";

const summary = (id: string, holesPlayed: number, toPar: number, total: number, date = "2026-09-01T12:00:00.000Z") => ({
  id,
  holesPlayed,
  toPar,
  total,
  date,
});

describe("roundFormat", () => {
  it("names nines and eighteens and nothing else", () => {
    expect(roundFormat(9)).toBe("nine");
    expect(roundFormat(18)).toBe("eighteen");
    expect(roundFormat(12)).toBeNull();
  });
});

describe("litHalves", () => {
  it("lights the half of the round that was played", () => {
    expect(litHalves("front9", 9)).toEqual({ front: true, back: false });
    expect(litHalves("back9", 9)).toEqual({ front: false, back: true });
    expect(litHalves("full18", 18)).toEqual({ front: true, back: true });
  });

  it("goes by holes played when a nine-hole course was saved as a full round", () => {
    expect(litHalves("full18", 9)).toEqual({ front: true, back: false });
  });
});

describe("formatLabel", () => {
  it("says which nine, or that it was all eighteen", () => {
    expect(formatLabel("front9", 9)).toBe("Front 9");
    expect(formatLabel("back9", 9)).toBe("Back 9");
    expect(formatLabel("full18", 18)).toBe("18 holes");
  });

  it("does not call a nine-hole course played in full an eighteen", () => {
    expect(formatLabel("full18", 9)).toBe("9 holes");
  });

  it("has a short form for tight spaces", () => {
    expect(shortFormatLabel(9)).toBe("9");
    expect(shortFormatLabel(18)).toBe("18");
  });
});

describe("pace", () => {
  it("puts a nine and an eighteen played at the same pace on equal terms", () => {
    expect(pacePerHole(24, 18)).toBe(pacePerHole(12, 9));
  });

  it("gives equal pace equal height, whatever the length of the round", () => {
    const [nine, eighteen] = paceHeights([pacePerHole(12, 9), pacePerHole(24, 18)]);
    expect(nine).toBe(eighteen);
  });

  it("gives the worst pace on screen the tallest bar", () => {
    const heights = paceHeights([2.0, 2.5, 1.9]);
    expect(heights[1]).toBe(100);
    expect(heights[1]).toBeGreaterThan(heights[0]);
    expect(heights[0]).toBeGreaterThan(heights[2]);
  });

  it("still separates rounds far above +12, where the old bars all hit the cap", () => {
    const heights = paceHeights([pacePerHole(18, 9), pacePerHole(22, 9), pacePerHole(45, 18)]);
    expect(new Set(heights).size).toBe(3);
  });

  it("draws an under-par round below an even-par one", () => {
    const [under, even, over] = paceHeights([-0.2, 0, 1]);
    expect(under).toBeLessThan(even);
    expect(even).toBeLessThan(over);
  });

  it("handles no rounds, one round and all-even rounds", () => {
    expect(paceHeights([])).toEqual([]);
    expect(paceHeights([1.5])).toEqual([100]);
    expect(paceHeights([0, 0])).toEqual([14, 14]);
  });
});

describe("bestByFormat", () => {
  it("does not let a nine win the eighteen", () => {
    const best = bestByFormat([summary("nine", 9, 17, 51), summary("eighteen", 18, 30, 102)]);
    expect(best.nine?.id).toBe("nine");
    expect(best.eighteen?.id).toBe("eighteen");
  });

  it("picks the lowest score against par within each format", () => {
    const best = bestByFormat([
      summary("ok-nine", 9, 20, 55),
      summary("good-nine", 9, 14, 49),
      summary("ok-eighteen", 18, 40, 110),
      summary("good-eighteen", 18, 33, 103),
    ]);
    expect(best.nine?.id).toBe("good-nine");
    expect(best.eighteen?.id).toBe("good-eighteen");
  });

  it("breaks a tie on to-par with the lower total, then the more recent round", () => {
    const byTotal = bestByFormat([summary("higher", 9, 14, 50), summary("lower", 9, 14, 48)]);
    expect(byTotal.nine?.id).toBe("lower");

    const byDate = bestByFormat([
      summary("older", 9, 14, 49, "2026-08-01T12:00:00.000Z"),
      summary("newer", 9, 14, 49, "2026-09-01T12:00:00.000Z"),
    ]);
    expect(byDate.nine?.id).toBe("newer");
  });

  it("leaves a format empty when none were played", () => {
    expect(bestByFormat([summary("nine", 9, 17, 51)]).eighteen).toBeNull();
  });

  it("ignores rounds that are neither a nine nor an eighteen", () => {
    expect(bestByFormat([summary("partial", 6, 2, 26)])).toEqual({ nine: null, eighteen: null });
  });
});

describe("describeFormatCounts", () => {
  it("counts nines and eighteens separately", () => {
    expect(describeFormatCounts([{ holesPlayed: 9 }, { holesPlayed: 9 }, { holesPlayed: 18 }])).toBe("2 nines · 1 eighteen");
  });

  it("leaves out a format with none", () => {
    expect(describeFormatCounts([{ holesPlayed: 18 }, { holesPlayed: 18 }])).toBe("2 eighteens");
  });

  it("returns null with nothing to count", () => {
    expect(describeFormatCounts([])).toBeNull();
  });
});

// Front nine and back nine each par 36.
const PARS = [4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 5, 4];

function course(holeCount = 18): Course {
  return {
    id: `test-links-${holeCount}`,
    name: "Test Links",
    shortName: "Test Links",
    location: "Rochester, NY",
    tee: "White",
    rating: 70,
    slope: 120,
    par: 72,
    yards: 6000,
    sourceUrl: "",
    holes: PARS.slice(0, holeCount).map((par, index) => ({ number: index + 1, par, yards: 350, handicap: index + 1, suggestedClub: "", strategy: "" })),
  };
}

/** Strokes against par from the first hole of the segment: hole 10 for a back nine, hole 1 otherwise. */
function played(segment: RoundSegment, toPars: number[], holeCount = 18): GolfRound {
  const firstHole = segment === "back9" ? 10 : 1;
  const layout = course(holeCount);
  return {
    id: `${segment}-${toPars.join("")}`,
    courseId: layout.id,
    courseName: layout.name,
    location: layout.location,
    segment,
    tee: "White",
    courseRating: 70,
    courseSlope: 120,
    course: layout,
    startedAt: "2026-09-01T14:00:00.000Z",
    completedAt: "2026-09-01T18:00:00.000Z",
    status: "completed",
    scores: Object.fromEntries(toPars.map((toPar, index) => [firstHole + index, PARS[firstHole + index - 1] + toPar])),
    events: [],
  };
}

const nineOf = (toPar: number, holes = 9) => ({ toPar, holes, pace: toPar / holes });

describe("roundNines", () => {
  it("splits an eighteen into its front and back", () => {
    const nines = roundNines(played("full18", [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1]));
    expect(nines.front).toEqual({ toPar: 0, holes: 9, pace: 0 });
    expect(nines.back).toEqual({ toPar: 9, holes: 9, pace: 1 });
  });

  it("fills only the half a nine-hole round covers", () => {
    const front = roundNines(played("front9", [2, 2, 2, 2, 2, 2, 2, 2, 2]));
    expect(front.front?.toPar).toBe(18);
    expect(front.back).toBeNull();

    const back = roundNines(played("back9", [1, 1, 1, 1, 1, 1, 1, 1, 1]));
    expect(back.front).toBeNull();
    expect(back.back?.toPar).toBe(9);
  });

  it("treats a nine-hole course saved as a full round as one front nine", () => {
    const nines = roundNines(played("full18", [1, 0, 1, 0, 1, 0, 1, 0, 1], 9));
    expect(nines.front?.toPar).toBe(5);
    expect(nines.back).toBeNull();
  });

  it("leaves out a nine with nothing scored", () => {
    const halfDone = played("full18", [1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(roundNines(halfDone).back).toBeNull();
  });
});

describe("nineBarHeights", () => {
  it("stands a worse back nine taller than its front", () => {
    const [bar] = nineBarHeights([{ front: nineOf(3), back: nineOf(8) }]);
    expect(bar.front).toBeLessThan(bar.back);
    expect(bar.back).toBe(100);
  });

  it("stands a better back nine shorter than its front", () => {
    const [bar] = nineBarHeights([{ front: nineOf(8), back: nineOf(3) }]);
    expect(bar.back).toBeLessThan(bar.front);
  });

  it("measures a nine-hole round and the matching half of an eighteen on one scale", () => {
    const [eighteen, nine] = nineBarHeights([
      { front: nineOf(4), back: nineOf(10) },
      { front: nineOf(10), back: null },
    ]);
    expect(nine.front).toBe(eighteen.back);
  });

  it("draws the unplayed half of a nine at the height of the half that was played", () => {
    const [frontNine, backNine] = nineBarHeights([
      { front: nineOf(6), back: null },
      { front: null, back: nineOf(12) },
    ]);
    expect(frontNine.back).toBe(frontNine.front);
    expect(backNine.front).toBe(backNine.back);
  });

  it("returns nothing for no rounds", () => {
    expect(nineBarHeights([])).toEqual([]);
  });
});
