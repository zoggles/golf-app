import { describe, expect, it } from "vitest";
import {
  addClub,
  bagGaps,
  catalogClub,
  CLUB_CATALOG,
  clubsByLoft,
  DEFAULT_BAG,
  isNewerBag,
  logShot,
  longestCarry,
  longestClubWithin,
  MAX_CARRY_YDS,
  MAX_CLUBS,
  MAX_SHOTS_PER_CLUB,
  MIN_CARRY_YDS,
  normalizeBag,
  pickClub,
  removeClub,
  removeShot,
  setCarry,
  shortestCarry,
  shotsSince,
  shotSpread,
  stepDown,
  suggestCarry,
  type Bag,
} from "./bag";
import { bagPayloadSchema } from "./bag-payloads";

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
  it("keeps range shots and the change stamp", () => {
    const bag = normalizeBag({
      updatedAt: "2026-10-02T12:00:00.000+00:00",
      clubs: [
        {
          id: "7i",
          label: "7 iron",
          carryYds: 145,
          shots: [
            { yds: 151, at: "2026-10-02T11:05:00.000Z" },
            { yds: 148, at: "2026-10-02T11:01:00.000Z" },
            { yds: "far", at: "2026-10-02T11:02:00.000Z" },
            { yds: 150, at: "not a date" },
          ],
        },
      ],
    });
    expect(bag.updatedAt).toBe("2026-10-02T12:00:00.000Z");
    expect(bag.clubs[0].shots).toEqual([
      { yds: 148, at: "2026-10-02T11:01:00.000Z" },
      { yds: 151, at: "2026-10-02T11:05:00.000Z" },
    ]);
  });
});

const club = (bag: Bag, id: string) => bag.clubs.find((item) => item.id === id)!;

describe("the catalog", () => {
  it("covers every default club", () => {
    for (const item of DEFAULT_BAG.clubs) expect(catalogClub(item.id)?.carryYds).toBe(item.carryYds);
  });

  it("has no repeated ids", () => {
    expect(new Set(CLUB_CATALOG.map((entry) => entry.id)).size).toBe(CLUB_CATALOG.length);
  });
});

describe("clubsByLoft", () => {
  it("holds its order when carries cross", () => {
    const crossed = setCarry(DEFAULT_BAG, "7i", 160);
    expect(clubsByLoft(crossed).map((item) => item.id)).toEqual(clubsByLoft(DEFAULT_BAG).map((item) => item.id));
    expect(clubsByLoft(DEFAULT_BAG)[0].id).toBe("driver");
    expect(clubsByLoft(DEFAULT_BAG).at(-1)?.id).toBe("lw");
  });
});

describe("adding and removing clubs", () => {
  it("scales a new club to how far this golfer hits the rest", () => {
    const long = { clubs: DEFAULT_BAG.clubs.map((item) => ({ ...item, carryYds: Math.round(item.carryYds * 1.1) })) };
    const fourIron = catalogClub("4i")!;
    expect(suggestCarry(DEFAULT_BAG, fourIron)).toBe(174);
    expect(suggestCarry(long, fourIron)).toBe(191);
  });

  it("stops at thirteen clubs, since the putter makes fourteen", () => {
    expect(DEFAULT_BAG.clubs).toHaveLength(MAX_CLUBS);
    expect(addClub(DEFAULT_BAG, "4i")).toBe(DEFAULT_BAG);
    const roomy = removeClub(DEFAULT_BAG, "lw");
    const added = addClub(roomy, "4i");
    expect(added.clubs).toHaveLength(MAX_CLUBS);
    expect(club(added, "4i").label).toBe("4 iron");
  });

  it("ignores unknown and repeated clubs", () => {
    const roomy = removeClub(DEFAULT_BAG, "lw");
    expect(addClub(roomy, "putter")).toBe(roomy);
    expect(addClub(roomy, "7i")).toBe(roomy);
  });

  it("never empties the bag", () => {
    const one = { clubs: [DEFAULT_BAG.clubs[0]] };
    expect(removeClub(one, "driver")).toBe(one);
  });

  it("clamps a typed carry", () => {
    expect(club(setCarry(DEFAULT_BAG, "7i", 2), "7i").carryYds).toBe(MIN_CARRY_YDS);
    expect(club(setCarry(DEFAULT_BAG, "7i", 151.6), "7i").carryYds).toBe(152);
  });
});

describe("range shots", () => {
  it("logs, trims and removes shots", () => {
    let bag = DEFAULT_BAG;
    for (let index = 0; index < MAX_SHOTS_PER_CLUB + 5; index += 1) {
      bag = logShot(bag, "7i", 140 + (index % 10), new Date(Date.UTC(2026, 9, 2, 12, 0, index)).toISOString());
    }
    const shots = club(bag, "7i").shots!;
    expect(shots).toHaveLength(MAX_SHOTS_PER_CLUB);
    expect(shots[0].at).toBe("2026-10-02T12:00:05.000Z");

    const trimmed = removeShot(bag, "7i", shots[0].at);
    expect(club(trimmed, "7i").shots).toHaveLength(MAX_SHOTS_PER_CLUB - 1);
    expect(club(trimmed, "8i").shots).toBeUndefined();
  });

  it("reads a median that one mishit cannot drag down", () => {
    const shots = [150, 152, 61, 149, 151].map((yds, index) => ({ yds, at: `2026-10-02T12:00:0${index}.000Z` }));
    expect(shotSpread(shots)).toEqual({ count: 5, median: 150, min: 61, max: 152 });
    expect(shotSpread([])).toBeNull();
  });

  it("separates this session from earlier ones", () => {
    let bag = logShot(DEFAULT_BAG, "pw", 100, "2026-09-28T15:00:00.000Z");
    bag = logShot(bag, "pw", 108, "2026-10-02T15:00:00.000Z");
    expect(shotsSince(club(bag, "pw"), "2026-10-02T14:00:00.000Z").map((shot) => shot.yds)).toEqual([108]);
  });
});

describe("bagGaps", () => {
  it("finds nothing to flag in the default bag", () => {
    expect(bagGaps(DEFAULT_BAG).every((gap) => gap.tone === "even")).toBe(true);
  });

  it("flags a hole, a pair doing one job, and a crossed pair", () => {
    const tones = (bag: Bag) => Object.fromEntries(bagGaps(bag).map((gap) => [`${gap.upper.id}-${gap.lower.id}`, gap.tone]));
    expect(tones(removeClub(DEFAULT_BAG, "gw"))["pw-sw"]).toBe("wide");
    expect(tones(setCarry(DEFAULT_BAG, "8i", 142))["7i-8i"]).toBe("tight");
    const crossed = bagGaps(setCarry(DEFAULT_BAG, "7i", 160)).find((gap) => gap.upper.id === "6i");
    expect(crossed?.yds).toBe(-5);
    expect(crossed?.tone).toBe("tight");
  });

  it("never calls the step down from driver wide", () => {
    expect(bagGaps(setCarry(DEFAULT_BAG, "driver", 260))[0].tone).toBe("even");
  });
});

describe("syncing", () => {
  it("orders bags by their stamp, with an unstamped bag oldest", () => {
    const older = { ...DEFAULT_BAG, updatedAt: "2026-10-01T10:00:00.000Z" };
    const newer = { ...DEFAULT_BAG, updatedAt: "2026-10-02T10:00:00.000Z" };
    expect(isNewerBag(newer, older)).toBe(true);
    expect(isNewerBag(older, newer)).toBe(false);
    expect(isNewerBag(older, DEFAULT_BAG)).toBe(true);
    expect(isNewerBag(DEFAULT_BAG, null)).toBe(false);
  });

  it("accepts a bag the app would send and refuses a malformed one", () => {
    const bag = logShot({ ...DEFAULT_BAG, updatedAt: new Date().toISOString() }, "7i", 150, new Date().toISOString());
    expect(bagPayloadSchema.safeParse({ bag }).success).toBe(true);
    expect(bagPayloadSchema.safeParse({ bag: { clubs: [], updatedAt: bag.updatedAt } }).success).toBe(false);
    expect(bagPayloadSchema.safeParse({ bag: { clubs: bag.clubs } }).success).toBe(false);
  });
});
