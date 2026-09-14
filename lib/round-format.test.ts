import { describe, expect, it } from "vitest";
import {
  bestByFormat,
  describeFormatCounts,
  formatLabel,
  litHalves,
  pacePerHole,
  paceHeights,
  roundFormat,
  shortFormatLabel,
} from "./round-format";

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
