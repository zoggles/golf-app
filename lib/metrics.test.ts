import { describe, expect, it } from "vitest";
import { GENESEE_VALLEY_SOUTH } from "./courses";
import { estimateRoundHandicap, handicapStrokesForHole } from "./metrics";

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
