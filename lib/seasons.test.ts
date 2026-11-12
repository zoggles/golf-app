import { describe, expect, it } from "vitest";
import { estimateHandicap } from "./metrics";
import { ALL_SEASONS, describeSeasonHandicap, pickSeason, roundsInSeason, seasonHandicap, seasonOf, seasonsFor } from "./seasons";
import type { Course, GolfRound } from "./types";

const COURSE: Course = {
  id: "test-course",
  name: "Test Links",
  shortName: "Test Links",
  location: "Rochester, NY",
  tee: "White",
  rating: 34,
  slope: 113,
  par: 36,
  yards: 2900,
  sourceUrl: "",
  holes: Array.from({ length: 9 }, (_, index) => ({
    number: index + 1,
    par: 4,
    yards: 320,
    handicap: index + 1,
    suggestedClub: "Driver",
    strategy: "",
  })),
};

/** A finished nine at local noon on the given day, every hole scored the same. */
function round(id: string, year: number, month: number, day: number, strokesPerHole = 5): GolfRound {
  const finished = new Date(year, month - 1, day, 12).toISOString();
  return {
    id,
    courseId: COURSE.id,
    courseName: COURSE.name,
    location: COURSE.location,
    segment: "front9",
    tee: COURSE.tee,
    courseRating: COURSE.rating,
    courseSlope: COURSE.slope,
    course: COURSE,
    startedAt: finished,
    completedAt: finished,
    status: "completed",
    scores: Object.fromEntries(COURSE.holes.map((hole) => [hole.number, strokesPerHole])),
    events: [],
  };
}

describe("seasonOf", () => {
  it("files a round under the local year of the day it finished", () => {
    expect(seasonOf(round("a", 2026, 11, 10))).toBe(2026);
    expect(seasonOf(round("b", 2027, 1, 1))).toBe(2027);
  });

  it("falls back to the start for a round still being played", () => {
    const active = { ...round("a", 2026, 12, 31), completedAt: undefined, status: "active" as const };
    expect(seasonOf(active)).toBe(2026);
  });

  it("follows a round whose date is corrected into another year", () => {
    const moved = { ...round("a", 2026, 6, 1), completedAt: new Date(2025, 9, 4, 12).toISOString() };
    expect(seasonOf(moved)).toBe(2025);
  });
});

describe("seasonsFor", () => {
  it("lists each season with a round once, newest first", () => {
    const rounds = [round("a", 2025, 5, 1), round("b", 2026, 6, 1), round("c", 2025, 9, 1), round("d", 2026, 8, 1)];
    expect(seasonsFor(rounds, 2026)).toEqual([2026, 2025]);
  });

  it("always offers the season under way, even before its first round", () => {
    expect(seasonsFor([round("a", 2026, 6, 1)], 2027)).toEqual([2027, 2026]);
    expect(seasonsFor([], 2027)).toEqual([2027]);
  });

  it("leaves out a round with no readable date", () => {
    const broken = { ...round("a", 2026, 6, 1), startedAt: "not a date", completedAt: undefined };
    expect(seasonsFor([broken], 2026)).toEqual([2026]);
  });
});

describe("pickSeason", () => {
  const seasons = [2027, 2026];

  it("opens on the season under way", () => {
    expect(pickSeason(null, seasons, 2027)).toBe(2027);
  });

  it("keeps a season picked earlier in the visit", () => {
    expect(pickSeason("2026", seasons, 2027)).toBe(2026);
    expect(pickSeason(ALL_SEASONS, seasons, 2027)).toBe(ALL_SEASONS);
  });

  it("drops a pick that this golfer has no season for", () => {
    expect(pickSeason("2019", seasons, 2027)).toBe(2027);
    expect(pickSeason("nonsense", seasons, 2027)).toBe(2027);
  });
});

describe("roundsInSeason", () => {
  const rounds = [round("a", 2025, 5, 1), round("b", 2026, 6, 1), round("c", 2026, 9, 1)];

  it("keeps only that year's rounds", () => {
    expect(roundsInSeason(rounds, 2026).map((item) => item.id)).toEqual(["b", "c"]);
    expect(roundsInSeason(rounds, 2027)).toEqual([]);
  });

  it("keeps everything for all time", () => {
    expect(roundsInSeason(rounds, ALL_SEASONS)).toBe(rounds);
  });
});

describe("seasonHandicap", () => {
  const rounds = [round("a", 2025, 5, 1, 6), round("b", 2025, 8, 1, 6), round("c", 2026, 6, 1, 5), round("d", 2026, 9, 1, 5)];

  it("carries the index from earlier seasons into a new one", () => {
    const opening = seasonHandicap(rounds, 2027);
    expect(opening.start).toBe(estimateHandicap(rounds));
    expect(opening.end).toBe(opening.start);
  });

  it("measures a season from the index it started with to the one it ended with", () => {
    const season = seasonHandicap(rounds, 2026);
    expect(season.start).toBe(estimateHandicap(rounds.slice(0, 2)));
    expect(season.end).toBe(estimateHandicap(rounds));
    expect(season.end!).toBeLessThan(season.start!);
  });

  it("ignores later seasons when looking back at an earlier one", () => {
    expect(seasonHandicap(rounds, 2025)).toEqual({ start: null, end: estimateHandicap(rounds.slice(0, 2)) });
  });

  it("uses every round for all time", () => {
    expect(seasonHandicap(rounds, ALL_SEASONS)).toEqual({ start: null, end: estimateHandicap(rounds) });
  });
});

describe("describeSeasonHandicap", () => {
  it("says where the season started and which way it went", () => {
    expect(describeSeasonHandicap({ start: 16.1, end: 14.7 }, 2026)).toEqual({ text: "Started 2026 at 16.1 · down 1.4", tone: "under" });
    expect(describeSeasonHandicap({ start: 12, end: 12.8 }, 2026)).toEqual({ text: "Started 2026 at 12.0 · up 0.8", tone: "over" });
    expect(describeSeasonHandicap({ start: 12, end: 12 }, 2027)).toEqual({ text: "Started 2027 at 12.0 · no change", tone: "even" });
  });

  it("has nothing to say in a golfer's first season", () => {
    expect(describeSeasonHandicap({ start: null, end: 18.2 }, 2026)).toBeNull();
  });
});
