import { describe, expect, it } from "vitest";
import { dateInputValue, parseDateInput, roundDateInputValue, shiftRoundToDate } from "./round-date";
import { GENESEE_VALLEY_SOUTH } from "./courses";
import type { GolfRound } from "./types";

/** Local-time helper so these read the way the golfer's calendar does. */
function localIso(year: number, month: number, day: number, hour: number, minute = 0): string {
  return new Date(year, month - 1, day, hour, minute).toISOString();
}

function round(overrides: Partial<GolfRound> = {}): GolfRound {
  return {
    id: "round-1",
    courseId: GENESEE_VALLEY_SOUTH.id,
    courseName: GENESEE_VALLEY_SOUTH.name,
    location: GENESEE_VALLEY_SOUTH.location,
    segment: "front9",
    tee: GENESEE_VALLEY_SOUTH.tee,
    courseRating: GENESEE_VALLEY_SOUTH.rating,
    courseSlope: GENESEE_VALLEY_SOUTH.slope,
    course: GENESEE_VALLEY_SOUTH,
    startedAt: localIso(2026, 9, 8, 14, 5),
    completedAt: localIso(2026, 9, 8, 17, 30),
    status: "completed",
    scores: {},
    events: [],
    ...overrides,
  };
}

function localParts(iso: string): [number, number, number, number, number] {
  const date = new Date(iso);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes()];
}

describe("roundDateInputValue", () => {
  it("reads the day the round is filed under", () => {
    expect(roundDateInputValue(round())).toBe("2026-09-08");
  });

  it("falls back to the start when a round never finished", () => {
    expect(roundDateInputValue(round({ completedAt: undefined, status: "active" }))).toBe("2026-09-08");
  });

  it("uses the finishing day for a round that ran past midnight", () => {
    const late = round({ startedAt: localIso(2026, 9, 8, 22, 30), completedAt: localIso(2026, 9, 9, 1, 15) });
    expect(roundDateInputValue(late)).toBe("2026-09-09");
  });
});

describe("shiftRoundToDate", () => {
  it("moves both timestamps and keeps the time of day", () => {
    const shifted = shiftRoundToDate(round(), "2026-05-30");

    expect(localParts(shifted!.startedAt)).toEqual([2026, 5, 30, 14, 5]);
    expect(localParts(shifted!.completedAt!)).toEqual([2026, 5, 30, 17, 30]);
  });

  it("moves a round forward as readily as back", () => {
    const shifted = shiftRoundToDate(round(), "2026-09-09");
    expect(localParts(shifted!.completedAt!)).toEqual([2026, 9, 9, 17, 30]);
  });

  it("keeps a round that ran past midnight spanning two days", () => {
    const late = round({ startedAt: localIso(2026, 9, 8, 22, 30), completedAt: localIso(2026, 9, 9, 1, 15) });
    const shifted = shiftRoundToDate(late, "2026-07-04");

    // The card is filed under the finish, so the start lands on the day before.
    expect(localParts(shifted!.startedAt)).toEqual([2026, 7, 3, 22, 30]);
    expect(localParts(shifted!.completedAt!)).toEqual([2026, 7, 4, 1, 15]);
  });

  it("carries the time of day across a daylight saving boundary", () => {
    const summer = round({ startedAt: localIso(2026, 7, 4, 9, 0), completedAt: localIso(2026, 7, 4, 12, 45) });
    const shifted = shiftRoundToDate(summer, "2026-01-10");

    expect(localParts(shifted!.startedAt)).toEqual([2026, 1, 10, 9, 0]);
    expect(localParts(shifted!.completedAt!)).toEqual([2026, 1, 10, 12, 45]);
  });

  it("leaves an unfinished round with only a start", () => {
    const active = round({ completedAt: undefined, status: "active" });
    const shifted = shiftRoundToDate(active, "2026-05-30");

    expect(localParts(shifted!.startedAt)).toEqual([2026, 5, 30, 14, 5]);
    expect(shifted).not.toHaveProperty("completedAt");
  });

  it("reports no change rather than rewriting the same day", () => {
    expect(shiftRoundToDate(round(), "2026-09-08")).toBeNull();
  });

  it("refuses a date that is not one", () => {
    for (const value of ["", "2026-02-31", "30/05/2026", "2026-9-8", "yesterday"]) {
      expect(shiftRoundToDate(round(), value)).toBeNull();
    }
  });
});

describe("date input values", () => {
  it("round-trips through the input format", () => {
    expect(dateInputValue(parseDateInput("2026-01-05")!)).toBe("2026-01-05");
  });

  it("rejects a day that does not exist", () => {
    expect(parseDateInput("2025-02-29")).toBeNull();
    expect(parseDateInput("2024-02-29")).not.toBeNull();
  });
});
