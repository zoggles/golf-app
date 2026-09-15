import { normalizeLocation } from "./course-location";
import { getCourse, getSegmentHoles } from "./courses";
import { summarizeRound } from "./metrics";
import { scoringTrend } from "./personal-baseline";
import { normalizeTee } from "./tee-selection";
import type { GolfRound } from "./types";

/** Compare only fully scored rounds on the same course, tees and hole layout. */
export function courseTrends(rounds: GolfRound[]) {
  const groups = new Map<string, GolfRound[]>();
  for (const round of rounds) {
    if (round.status !== "completed") continue;
    const course = round.course ?? getCourse(round.courseId);
    const holes = getSegmentHoles(course, round.segment);
    if (holes.length !== 9 && holes.length !== 18) continue;
    if (holes.some((hole) => !Number.isFinite(round.scores[hole.number]) || round.scores[hole.number] <= 0)) continue;
    const key = JSON.stringify([
      normalizeTee(course.name), normalizeLocation(course.location),
      normalizeTee(round.tee || course.tee),
      holes.map((hole) => [hole.number, hole.par]),
    ]);
    const group = groups.get(key) ?? [];
    group.push(round);
    groups.set(key, group);
  }
  return [...groups].map(([key, entries]) => {
    const ordered = entries.map((round) => ({ round, summary: summarizeRound(round) }))
      .sort((a, b) => Date.parse(a.summary.date) - Date.parse(b.summary.date) || a.round.id.localeCompare(b.round.id));
    const latest = ordered[ordered.length - 1];
    const course = latest.round.course ?? getCourse(latest.round.courseId);
    const holes = latest.summary.holesPlayed as 9 | 18;
    return {
      key, name: course.shortName, location: course.location,
      tee: latest.round.tee || course.tee, segment: latest.round.segment, holes,
      points: ordered.map((entry) => entry.summary),
      best: Math.min(...ordered.map((entry) => entry.summary.total)),
      average: ordered.reduce((sum, entry) => sum + entry.summary.total, 0) / ordered.length,
      trend: scoringTrend(ordered.map((entry) => entry.round), { holes }),
    };
  }).sort((a, b) => Date.parse(b.points[b.points.length - 1].date) - Date.parse(a.points[a.points.length - 1].date));
}
