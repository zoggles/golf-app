import { describe, expect, it } from "vitest";
import { GENESEE_VALLEY_SOUTH } from "./courses";
import { buildImportedRound, ScorecardImportError, type ScorecardReading } from "./scorecard-import";

/**
 * Covers the decisions made between a photographed card and a stored round:
 * which course it belongs to, which nine it is, and which numbers survive.
 */

const NOW = new Date(2026, 5, 1, 15);

function reading(overrides: Partial<ScorecardReading> = {}): ScorecardReading {
  const holes = Array.from({ length: 9 }, (_, index) => ({ number: index + 1, par: 4, yards: 300 }));
  return {
    courseName: "Riverside Municipal",
    location: "Ithaca, NY",
    tee: "White",
    datePlayed: "2026-05-30",
    holes,
    players: [{ name: "Nick", scores: holes.map((hole) => ({ hole: hole.number, strokes: 5 })) }],
    note: "",
    ...overrides,
  };
}

/** The same nine, numbered the way the back of a card is. */
function backNine(): Pick<ScorecardReading, "holes" | "players"> {
  const holes = Array.from({ length: 9 }, (_, index) => ({ number: index + 10, par: 4, yards: 320 }));
  return { holes, players: [{ name: "Nick", scores: holes.map((hole) => ({ hole: hole.number, strokes: 6 })) }] };
}

describe("buildImportedRound", () => {
  it("builds a course from the card when the app has never seen it", () => {
    const result = buildImportedRound(reading(), { now: NOW });

    expect(result.matchedKnownCourse).toBe(false);
    expect(result.segment).toBe("front9");
    expect(result.course.name).toBe("Riverside Municipal");
    expect(result.course.par).toBe(36);
    expect(result.course.yards).toBe(2700);
    expect(result.course.holes).toHaveLength(9);
    expect(result.scores[1]).toBe(5);
    expect(result.missingHoles).toEqual([]);
  });

  it("reuses a saved scorecard when the card names a course the app already holds", () => {
    const holes = GENESEE_VALLEY_SOUTH.holes.slice(9).map((hole) => ({ number: hole.number, par: hole.par }));
    const result = buildImportedRound(
      reading({
        courseName: "Genesee Valley Golf Course - South",
        holes,
        players: [{ name: "Nick", scores: holes.map((hole) => ({ hole: hole.number, strokes: 4 })) }],
      }),
      { now: NOW },
    );

    expect(result.matchedKnownCourse).toBe(true);
    expect(result.course.id).toBe(GENESEE_VALLEY_SOUTH.id);
    expect(result.segment).toBe("back9");
    // The saved course keeps real hole numbers, so scores stay on 10 through 18.
    expect(Object.keys(result.scores)).toEqual(GENESEE_VALLEY_SOUTH.holes.slice(9).map((hole) => String(hole.number)));
  });

  it("renumbers a standalone back nine onto its own course and says so in the name", () => {
    const result = buildImportedRound(reading({ courseName: "Hillview Club", ...backNine() }), { now: NOW });

    expect(result.matchedKnownCourse).toBe(false);
    expect(result.segment).toBe("front9");
    expect(result.course.name).toBe("Hillview Club — Back 9");
    expect(result.course.holes.map((hole) => hole.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(result.scores[1]).toBe(6);
    expect(result.scores[9]).toBe(6);
  });

  it("reads the requested player column", () => {
    const holes = reading().holes;
    const result = buildImportedRound(
      reading({
        players: [
          { name: "Dana", scores: holes.map((hole) => ({ hole: hole.number, strokes: 4 })) },
          { name: "Nick", scores: holes.map((hole) => ({ hole: hole.number, strokes: 7 })) },
        ],
      }),
      { playerIndex: 1, now: NOW },
    );

    expect(Object.values(result.scores).every((strokes) => strokes === 7)).toBe(true);
  });

  it("reports an unreadable box instead of inventing a score for it", () => {
    const holes = reading().holes;
    const result = buildImportedRound(
      reading({
        players: [
          {
            name: "Nick",
            scores: holes.filter((hole) => hole.number !== 4).map((hole) => ({ hole: hole.number, strokes: 5 })),
          },
        ],
      }),
      { now: NOW },
    );

    expect(result.missingHoles).toEqual([4]);
    expect(result.scores[4]).toBeUndefined();
  });

  it("refuses a card that is only part of a nine", () => {
    const holes = reading().holes.slice(0, 5);
    expect(() =>
      buildImportedRound(
        { ...reading(), holes, players: [{ name: "Nick", scores: [{ hole: 1, strokes: 5 }] }] },
        { now: NOW },
      ),
    ).toThrow(ScorecardImportError);
  });

  it("keeps the date printed on the card, and never files a round in the future", () => {
    const dated = new Date(buildImportedRound(reading(), { now: NOW }).playedAt);
    expect([dated.getFullYear(), dated.getMonth(), dated.getDate()]).toEqual([2026, 4, 30]);

    // Cards are usually dated the way the pro shop writes them, not in ISO.
    for (const written of ["5/30/2026", "05-30-2026", "5/30/26", "30.5.2026"]) {
      const parsed = new Date(buildImportedRound(reading({ datePlayed: written }), { now: NOW }).playedAt);
      expect([parsed.getFullYear(), parsed.getMonth(), parsed.getDate()]).toEqual([2026, 4, 30]);
    }

    const impossible = new Date(buildImportedRound(reading({ datePlayed: "2026-02-31" }), { now: NOW }).playedAt);
    expect(impossible.getTime()).toBe(NOW.getTime());

    const misread = new Date(buildImportedRound(reading({ datePlayed: "2126-05-30" }), { now: NOW }).playedAt);
    expect(misread.getTime()).toBe(NOW.getTime());

    const undated = new Date(buildImportedRound(reading({ datePlayed: "" }), { now: NOW }).playedAt);
    expect(undated.getTime()).toBe(NOW.getTime());
  });

  it("keeps printed stroke indexes only when the whole card carries them", () => {
    const printed = reading().holes.map((hole, index) => ({ ...hole, handicap: 9 - index }));
    expect(buildImportedRound(reading({ holes: printed }), { now: NOW }).course.holes.map((hole) => hole.handicap))
      .toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1]);

    const partial = printed.map((hole, index) => (index === 3 ? { ...hole, handicap: undefined } : hole));
    expect(buildImportedRound(reading({ holes: partial }), { now: NOW }).course.holes.map((hole) => hole.handicap))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("prints the tee the way the rest of the app does", () => {
    expect(buildImportedRound(reading({ tee: "WHITE TEES" }), { now: NOW }).course.tee).toBe("White");
    expect(buildImportedRound(reading({ tee: "blue tee" }), { now: NOW }).course.tee).toBe("Blue");
    expect(buildImportedRound(reading({ tee: "" }), { now: NOW }).course.tee).toBe("Unspecified");
  });

  it("gives a card with no printed rating a usable rating and slope", () => {
    const course = buildImportedRound(reading(), { now: NOW }).course;
    expect(course.rating).toBe(36);
    expect(course.slope).toBe(113);

    const printed = buildImportedRound(reading({ rating: 68.4, slope: 121 }), { now: NOW }).course;
    expect(printed.rating).toBe(68.4);
    expect(printed.slope).toBe(121);
  });
});
