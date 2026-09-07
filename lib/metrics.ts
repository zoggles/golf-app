import { getCourse, getSegmentHoles, segmentLabel } from "./courses";
import type { GolfRound } from "./types";

export interface RoundSummary {
  id: string;
  courseName: string;
  date: string;
  total: number;
  par: number;
  toPar: number;
  segment: string;
  holesPlayed: number;
}

export function summarizeRound(round: GolfRound): RoundSummary {
  const course = getCourse(round.courseId);
  const holes = getSegmentHoles(course, round.segment);
  const scored = holes.filter((hole) => round.scores[hole.number] != null);
  const total = scored.reduce((sum, hole) => sum + round.scores[hole.number], 0);
  const par = scored.reduce((sum, hole) => sum + hole.par, 0);
  return {
    id: round.id,
    courseName: round.courseName,
    date: round.completedAt ?? round.startedAt,
    total,
    par,
    toPar: total - par,
    segment: segmentLabel(round.segment),
    holesPlayed: scored.length,
  };
}

export function formatToPar(value: number): string {
  if (value === 0) return "E";
  return value > 0 ? `+${value}` : String(value);
}

export function estimateHandicap(rounds: GolfRound[]): number | null {
  const completed = rounds
    .filter((round) => round.status === "completed")
    .map((round) => {
      const summary = summarizeRound(round);
      if (summary.holesPlayed < 9) return null;
      const course = getCourse(round.courseId);
      const scale = summary.holesPlayed === 9 ? 2 : 1;
      const adjustedScore = summary.total * scale;
      const adjustedRating = course.rating;
      return ((adjustedScore - adjustedRating) * 113) / round.courseSlope;
    })
    .filter((value): value is number => value != null)
    .sort((a, b) => a - b)
    .slice(0, 20);
  if (completed.length === 0) return null;
  const count = Math.max(1, Math.ceil(completed.length * 0.4));
  const best = completed.slice(0, count);
  const average = best.reduce((sum, value) => sum + value, 0) / best.length;
  return Math.max(0, Math.round(average * 10) / 10);
}

export function scoringAverage(rounds: GolfRound[]): number | null {
  const summaries = rounds
    .filter((round) => round.status === "completed")
    .map(summarizeRound)
    .filter((round) => round.holesPlayed >= 9)
    .map((round) => (round.total / round.holesPlayed) * 18);
  if (!summaries.length) return null;
  return Math.round((summaries.reduce((sum, score) => sum + score, 0) / summaries.length) * 10) / 10;
}
