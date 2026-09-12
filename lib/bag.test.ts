import { describe, expect, it } from "vitest";
import {
  DEFAULT_BAG,
  longestCarry,
  longestClubWithin,
  MAX_CARRY_YDS,
  MIN_CARRY_YDS,
  normalizeBag,
  pickClub,
  shortestCarry,
  stepDown,
} from "./bag";

describe("DEFAULT_BAG", () => {
  it("runs longest to shortest with no repeated ids", () => {
    const carries = DEFAULT_BAG.clubs.map((club) => club.carryYds);
    expect([...carries].sort((left, right) => right - left)).toEqual(carries);
    expect(new Set(DEFAULT_BAG.clubs.map((club) => club.id)).size).toBe(DEFAULT_BAG.clubs.length);
  });

  it("spans a usable range", () => {
    expect(longestCarry(DEFAULT_BAG)).toBe(230);
    expect(shortestCarry(DEFAULT_BAG)).toBe(60);
  });
});

describe("pickClub", () => {
  it("takes the nearest carry", () => {
    expect(pickClub(DEFAULT_BAG, 145)?.club.id).toBe("7i");
    expect(pickClub(DEFAULT_BAG, 120)?.club.id).toBe("9i");
  });

  it("prefers the closer club when the gap is clear", () => {
    // 7 iron is 3 short, 6 iron is 7 long. The bias is only 3, so 7 iron still wins.
    expect(pickClub(DEFAULT_BAG, 148)?.club.id).toBe("7i");
  });

  it("breaks a near-tie toward the longer club", () => {
    // 6 iron 155 is 5 long, 7 iron 145 is 5 short. Going long is the safer miss.
    expect(pickClub(DEFAULT_BAG, 150)?.club.id).toBe("6i");
  });

  it("reports the shortfall when nothing reaches", () => {
    const pick = pickClub(DEFAULT_BAG, 280);
    expect(pick?.club.id).toBe("driver");
    expect(pick?.confident).toBe(false);
    expect(pick?.deltaYds).toBe(-50);
  });

  it("is confident at the very edge of the bag", () => {
    expect(pickClub(DEFAULT_BAG, 230)?.confident).toBe(true);
  });

  it("offers a second choice", () => {
    const pick = pickClub(DEFAULT_BAG, 145);
    expect(pick?.alternative).not.toBeNull();
    expect(pick?.alternative?.id).not.toBe(pick?.club.id);
  });

  it("returns null for an empty bag rather than guessing", () => {
    expect(pickClub({ clubs: [] }, 150)).toBeNull();
  });
});

describe("laying up", () => {
  it("finds the longest club that stays inside a limit", () => {
    expect(longestClubWithin(DEFAULT_BAG, 160)?.id).toBe("6i");
    expect(longestClubWithin(DEFAULT_BAG, 50)).toBeNull();
  });

  it("steps down one club at a time and stops at the bottom", () => {
    const sixIron = DEFAULT_BAG.clubs.find((club) => club.id === "6i")!;
    expect(stepDown(DEFAULT_BAG, sixIron)?.id).toBe("7i");

    const lobWedge = DEFAULT_BAG.clubs.find((club) => club.id === "lw")!;
    expect(stepDown(DEFAULT_BAG, lobWedge)).toBeNull();
  });
});

describe("normalizeBag", () => {
  it("falls back to the default for anything unusable", () => {
    expect(normalizeBag(null)).toEqual(DEFAULT_BAG);
    expect(normalizeBag({ clubs: "nope" })).toEqual(DEFAULT_BAG);
    expect(normalizeBag({ clubs: [] })).toEqual(DEFAULT_BAG);
    expect(normalizeBag({ clubs: [{ id: "x" }] })).toEqual(DEFAULT_BAG);
  });

  it("clamps carries into a plausible range", () => {
    const bag = normalizeBag({
      clubs: [
        { id: "driver", label: "Driver", carryYds: 9000 },
        { id: "lw", label: "Lob wedge", carryYds: 2 },
      ],
    });
    expect(bag.clubs[0].carryYds).toBe(MAX_CARRY_YDS);
    expect(bag.clubs[1].carryYds).toBe(MIN_CARRY_YDS);
  });

  it("sorts and drops repeated ids", () => {
    const bag = normalizeBag({
      clubs: [
        { id: "9i", label: "9 iron", carryYds: 120 },
        { id: "driver", label: "Driver", carryYds: 230 },
        { id: "9i", label: "9 iron again", carryYds: 999 },
      ],
    });
    expect(bag.clubs.map((club) => club.id)).toEqual(["driver", "9i"]);
  });

  it("leaves a good bag alone", () => {
    expect(normalizeBag(DEFAULT_BAG)).toEqual(DEFAULT_BAG);
  });
});
