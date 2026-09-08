import { describe, expect, it } from "vitest";
import { buildHistoryCsv, historyExportFilename } from "./history-export";
import type { Course, GolfRound } from "./types";

function course(overrides: Partial<Course> = {}): Course {
  return {
    id: "test-course",
    name: "Test Links",
    shortName: "Test Links",
    location: "Rochester, NY",
    tee: "White",
    rating: 65.2,
    slope: 109,
    par: 12,
    yards: 900,
    sourceUrl: "",
    holes: [
      { number: 1, par: 4, yards: 300, handicap: 5, suggestedClub: "Driver", strategy: "" },
      { number: 2, par: 3, yards: 150, handicap: 9, suggestedClub: "7 iron", strategy: "" },
      { number: 3, par: 5, yards: 450, handicap: 1, suggestedClub: "Driver", strategy: "" },
    ],
    ...overrides,
  };
}

const GOLFER = "Nell Ray";

function round(overrides: Partial<GolfRound> = {}): GolfRound {
  const base = course();
  return {
    id: "round-1",
    courseId: base.id,
    courseName: base.name,
    location: base.location,
    segment: "full18",
    tee: base.tee,
    courseRating: base.rating,
    courseSlope: base.slope,
    course: base,
    startedAt: "2026-05-30T14:00:00.000Z",
    completedAt: "2026-05-30T17:30:00.000Z",
    status: "completed",
    scores: { 1: 5, 2: 3, 3: 6 },
    events: [],
    ...overrides,
  };
}

function rows(csv: string): string[] {
  return csv.trimEnd().split("\r\n");
}

describe("buildHistoryCsv", () => {
  it("writes one row per hole with the round repeated on each row", () => {
    const lines = rows(buildHistoryCsv([round()], GOLFER));

    expect(lines).toHaveLength(4);
    expect(lines[0].split(",")).toContain("stroke_index");
    expect(lines[0].split(",")).toEqual(expect.arrayContaining(["putts", "fairway", "penalty_strokes", "blow_up"]));
    expect(lines[1]).toBe(
      "Nell Ray,2026-05-30,2026-05-30T17:30:00.000Z,completed,Test Links,\"Rochester, NY\",White,Full 18,65.2,109,1,4,300,5,5,1,,,,,,no,14,12,2,,3,round-1",
    );
    expect(lines[3]).toContain(",3,5,450,1,6,1,");
  });

  it("files a round under the day it was played, not the day UTC says", () => {
    // 9pm on the 30th in a western zone is already the 31st in UTC.
    const evening = round({ completedAt: new Date(2026, 4, 30, 21, 30).toISOString() });
    expect(rows(buildHistoryCsv([evening], GOLFER))[1].split(",")[1]).toBe("2026-05-30");
  });

  it("keeps two rounds on one day in the order they were played", () => {
    const csv = buildHistoryCsv(
      [
        round({ id: "second", completedAt: "2026-05-30T19:00:00.000Z" }),
        round({ id: "first", completedAt: "2026-05-30T15:00:00.000Z" }),
      ],
      GOLFER,
    );
    const ids = rows(csv)
      .slice(1)
      .map((line) => line.split(",").at(-1));
    expect(ids.slice(0, 3)).toEqual(["first", "first", "first"]);
    expect(ids.slice(3)).toEqual(["second", "second", "second"]);
  });

  it("orders rounds oldest first so the file reads as a history", () => {
    const csv = buildHistoryCsv(
      [
        round({ id: "newer", completedAt: "2026-06-02T12:00:00.000Z" }),
        round({ id: "older", completedAt: "2026-04-01T12:00:00.000Z" }),
      ],
      GOLFER,
    );

    const ids = rows(csv)
      .slice(1)
      .map((line) => line.split(",").at(-1));
    expect(ids).toEqual(["older", "older", "older", "newer", "newer", "newer"]);
  });

  it("leaves an unplayed hole blank and totals only what was scored", () => {
    const lines = rows(buildHistoryCsv([round({ status: "active", completedAt: undefined, scores: { 1: 5, 2: 3 } })], GOLFER));

    // Hole 3 has no score, no differential, and does not reach the round totals.
    expect(lines[3]).toBe("Nell Ray,2026-05-30,2026-05-30T14:00:00.000Z,active,Test Links,\"Rochester, NY\",White,Full 18,65.2,109,3,5,450,1,,,,,,,,,8,7,1,,2,round-1");
  });

  it("keeps a spreadsheet from reading a course name as a formula or a new column", () => {
    const named = course({ name: '=SUM(A1) "Old" Course, Ltd' });
    const line = rows(buildHistoryCsv([round({ course: named, courseName: named.name })], GOLFER))[1];

    expect(line).toContain('"\'=SUM(A1) ""Old"" Course, Ltd"');
  });

  it("carries the handicap strokes the app gives on each hole", () => {
    const nine = course({
      par: 36,
      holes: Array.from({ length: 9 }, (_, index) => ({
        number: index + 1,
        par: 4,
        yards: 320,
        handicap: index + 1,
        suggestedClub: "Driver",
        strategy: "",
      })),
    });
    const scores = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [index + 1, 6]));
    const csv = buildHistoryCsv([round({ course: nine, segment: "front9", scores })], GOLFER);
    const columns = rows(csv)[0].split(",");
    const cells = rows(csv)
      .slice(1)
      .map((line) => line.split(","));

    const handicapColumn = columns.indexOf("round_handicap") + 1;
    const givenColumn = columns.indexOf("hole_handicap_strokes") + 1;
    const netColumn = columns.indexOf("net_strokes") + 1;
    // The embedded comma in the location shifts every later column by one.
    const roundHandicap = Number(cells[0][handicapColumn]);
    expect(roundHandicap).toBeGreaterThan(0);
    // Strokes are given hardest hole first, so they total the round handicap.
    expect(cells.reduce((total, row) => total + Number(row[givenColumn]), 0)).toBe(roundHandicap);
    expect(Number(cells[0][netColumn])).toBe(6 - Number(cells[0][givenColumn]));
  });

  it("exports only the holes belonging to the round's segment", () => {
    const eighteen = course({
      holes: Array.from({ length: 18 }, (_, index) => ({
        number: index + 1,
        par: 4,
        yards: 300,
        handicap: index + 1,
        suggestedClub: "Driver",
        strategy: "",
      })),
    });
    const csv = buildHistoryCsv([round({ course: eighteen, segment: "back9", scores: { 10: 4 } })], GOLFER);

    expect(rows(csv)).toHaveLength(10);
    expect(rows(csv)[1]).toBe(
      "Nell Ray,2026-05-30,2026-05-30T17:30:00.000Z,completed,Test Links,\"Rochester, NY\",White,Back 9,65.2,109,10,4,300,10,4,0,,,,,,no,4,4,0,,1,round-1",
    );
  });

  it("exports only optional stats that were actually tracked", () => {
    const withStats = round({
      events: [{ id: "metric", at: "2026-05-30T17:00:00.000Z", source: "voice", text: "two putts, fairway hit", hole: 1, metrics: { putts: 2, fairway: "hit", penaltyStrokes: 0 } }],
    });
    const csv = buildHistoryCsv([withStats], GOLFER);
    const headers = rows(csv)[0].split(",");
    const first = rows(csv)[1].split(",");
    const shift = 1; // quoted location contains a comma
    expect(first[headers.indexOf("putts") + shift]).toBe("2");
    expect(first[headers.indexOf("fairway") + shift]).toBe("hit");
    expect(first[headers.indexOf("penalty_strokes") + shift]).toBe("0");
  });
});

describe("historyExportFilename", () => {
  it("stamps the file with the day it was exported", () => {
    expect(historyExportFilename(GOLFER, new Date(2026, 8, 8))).toBe("fairway-log-nell-ray-history-2026-09-08.csv");
  });

  it("still names a file when the golfer's name has nothing to slug", () => {
    expect(historyExportFilename("  ", new Date(2026, 8, 8))).toBe("fairway-log-golfer-history-2026-09-08.csv");
  });
});
