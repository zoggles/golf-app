import { describe, expect, it } from "vitest";
import { courseTrends } from "./course-trends";
import { GENESEE_VALLEY_SOUTH as course, getSegmentHoles } from "./courses";
import type { GolfRound } from "./types";

function round(id: string, strokes = 6, changes: Partial<GolfRound> = {}): GolfRound {
  const result: GolfRound = { id, courseId: course.id, courseName: course.shortName, location: course.location,
    segment: "front9", tee: "White", courseRating: course.rating, courseSlope: course.slope, course,
    startedAt: `2026-09-${id.padStart(2, "0")}T12:00:00Z`, status: "completed", scores: {}, events: [], ...changes };
  result.scores = Object.fromEntries(getSegmentHoles(result.course, result.segment).map((hole) => [hole.number, strokes]));
  return result;
}

describe("courseTrends", () => {
  it("keeps course difficulty, tees and nines separate", () => {
    const rounds = [round("1"), round("2", 5), round("3", 8, { course: { ...course, name: "Hard Course" } }),
      round("4", 7, { tee: "Blue" }), round("5", 6, { segment: "back9" }), round("6", 6, { segment: "full18" })];
    const groups = courseTrends(rounds);
    expect(groups).toHaveLength(5);
    const front = groups.find((group) => group.points.length === 2)!;
    expect(front.points.map((point) => point.total)).toEqual([54, 45]);
    expect(front.average).toBe(49.5);
    expect(front.best).toBe(45);
  });
  it("excludes active and incomplete rounds, including a half-scored eighteen", () => {
    const partial = round("2", 6, { segment: "full18" });
    delete partial.scores[18];
    expect(courseTrends([round("1", 6, { status: "active" }), partial])).toEqual([]);
  });
  it("uses corrected dates and includes a single round without claiming a trend", () => {
    const groups = courseTrends([round("1", 6, { completedAt: "2026-09-20T12:00:00Z" }), round("2", 5)]);
    expect(groups[0].points.map((point) => point.id)).toEqual(["2", "1"]);
    expect(courseTrends([round("1")])[0].trend.direction).toBeNull();
  });
  it("merges equivalent locations and IDs but separates changed pars and locations", () => {
    const original = round("1", 6, { course: { ...course, location: "Rochester, NY" } });
    const alias = round("2", 5, { course: { ...course, id: "other-id", location: "Rochester, New York" } });
    const other = round("3", 5, { course: { ...course, location: "Buffalo, NY" } });
    const layout = round("4", 5, { course: { ...course, holes: course.holes.map((hole) => ({ ...hole, par: 5 })) } });
    expect(courseTrends([original, alias, other, layout])).toHaveLength(3);
  });
  it("reads improvement only from repeated comparable rounds", () => {
    const group = courseTrends([round("4", 4), round("2", 6), round("1", 7), round("3", 5)])[0];
    expect(group.trend.direction).toBe("improving");
    expect(group.points.map((point) => point.total)).toEqual([63, 54, 45, 36]);
  });
});
