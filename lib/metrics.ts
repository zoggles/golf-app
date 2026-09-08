import { getCourse, getSegmentHoles, segmentLabel } from "./courses";
import type { Course, GolfRound, Hole, HoleMetrics, RoundSegment } from "./types";

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
  const course = round.course ?? getCourse(round.courseId);
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
      const course = round.course ?? getCourse(round.courseId);
      const scale = summary.holesPlayed === 9 ? 2 : 1;
      const adjustedScore = summary.total * scale;
      const adjustedRating = course.holes.length === 9 ? course.rating * 2 : course.rating;
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

export function estimateRoundHandicap(handicapIndex: number | null, course: Course, segment: RoundSegment): number | null {
  if (handicapIndex == null) return null;
  const holes = getSegmentHoles(course, segment);
  const segmentPar = holes.reduce((sum, hole) => sum + hole.par, 0);
  const isNineHoleRound = holes.length === 9;
  const indexForRound = isNineHoleRound ? handicapIndex / 2 : handicapIndex;
  const ratingForRound = isNineHoleRound && course.holes.length === 18 ? course.rating / 2 : course.rating;
  return Math.max(0, Math.round(indexForRound * (course.slope / 113) + (ratingForRound - segmentPar)));
}

export function handicapStrokesForHole(roundHandicap: number | null, hole: Hole, roundHoles: Hole[]): number {
  if (roundHandicap == null || roundHandicap <= 0 || !roundHoles.length) return 0;
  const ranked = [...roundHoles].sort((left, right) => left.handicap - right.handicap);
  const rank = ranked.findIndex((candidate) => candidate.number === hole.number);
  if (rank < 0) return 0;
  return Math.floor(roundHandicap / roundHoles.length) + (rank < roundHandicap % roundHoles.length ? 1 : 0);
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

export function holeMetricsByNumber(round: GolfRound): Record<number, HoleMetrics> {
  const result: Record<number, HoleMetrics> = {};
  const newestFirst = [...round.events].sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());
  for (const event of newestFirst) {
    if (!event.hole || !event.metrics) continue;
    const current = result[event.hole] ?? {};
    for (const key of ["putts", "penaltyStrokes", "fairway", "blowUp"] as const) {
      if (current[key] === undefined && event.metrics[key] !== undefined) {
        Object.assign(current, { [key]: event.metrics[key] });
      }
    }
    result[event.hole] = current;
  }
  return result;
}

export interface TrackedRoundMetrics {
  puttsTotal: number;
  puttsHoles: number;
  penaltyStrokes: number;
  penaltyHoles: number;
  fairwaysHit: number;
  fairwaysTracked: number;
  blowUpHoles: number;
  scoredHoles: number;
}

export function trackedRoundMetrics(round: GolfRound): TrackedRoundMetrics {
  const holes = getSegmentHoles(round.course ?? getCourse(round.courseId), round.segment);
  const metrics = holeMetricsByNumber(round);
  const tracked = holes.map((hole) => metrics[hole.number] ?? {});
  const fairways = tracked.filter((item) => item.fairway !== undefined);
  const scored = holes.filter((hole) => round.scores[hole.number] != null);
  const blowUps = new Set(
    scored.filter((hole) => round.scores[hole.number] >= hole.par + 3).map((hole) => hole.number),
  );
  holes.forEach((hole) => {
    if (metrics[hole.number]?.blowUp) blowUps.add(hole.number);
  });
  return {
    puttsTotal: tracked.reduce((sum, item) => sum + (item.putts ?? 0), 0),
    puttsHoles: tracked.filter((item) => item.putts !== undefined).length,
    penaltyStrokes: tracked.reduce((sum, item) => sum + (item.penaltyStrokes ?? 0), 0),
    penaltyHoles: tracked.filter((item) => item.penaltyStrokes !== undefined).length,
    fairwaysHit: fairways.filter((item) => item.fairway === "hit").length,
    fairwaysTracked: fairways.length,
    blowUpHoles: blowUps.size,
    scoredHoles: scored.length,
  };
}

export interface RoundInsight {
  tone: "strength" | "focus";
  text: string;
}

interface ComparableMetric {
  key: string;
  value: number;
  display: string;
  lowerIsBetter: boolean;
}

function comparableMetrics(round: GolfRound): ComparableMetric[] {
  const tracked = trackedRoundMetrics(round);
  const values: ComparableMetric[] = [];
  if (tracked.puttsHoles) values.push({
    key: "putts",
    value: tracked.puttsTotal / tracked.puttsHoles,
    display: `${(tracked.puttsTotal / tracked.puttsHoles).toFixed(1)} putts/hole`,
    lowerIsBetter: true,
  });
  if (tracked.fairwaysTracked) values.push({
    key: "fairways",
    value: tracked.fairwaysHit / tracked.fairwaysTracked,
    display: `${Math.round((tracked.fairwaysHit / tracked.fairwaysTracked) * 100)}% fairways`,
    lowerIsBetter: false,
  });
  if (tracked.penaltyHoles) values.push({
    key: "penalties",
    value: tracked.penaltyStrokes / tracked.penaltyHoles,
    display: `${tracked.penaltyStrokes} penalties`,
    lowerIsBetter: true,
  });
  if (tracked.scoredHoles) values.push({
    key: "blowups",
    value: tracked.blowUpHoles / tracked.scoredHoles,
    display: `${tracked.blowUpHoles} blow-up ${tracked.blowUpHoles === 1 ? "hole" : "holes"}`,
    lowerIsBetter: true,
  });
  return values;
}

/** Compares only facts that exist in at least two rounds; missing stats never become zeroes. */
export function buildRoundInsights(rounds: GolfRound[]): Map<string, RoundInsight[]> {
  const samples = new Map(rounds.map((round) => [round.id, comparableMetrics(round)]));
  const ranges = new Map<string, { min: number; max: number }>();
  const keys = new Set([...samples.values()].flatMap((sample) => sample.map((metric) => metric.key)));
  for (const key of keys) {
    const values = [...samples.values()].flatMap((sample) => sample.filter((metric) => metric.key === key).map((metric) => metric.value));
    if (values.length >= 2) ranges.set(key, { min: Math.min(...values), max: Math.max(...values) });
  }

  const result = new Map<string, RoundInsight[]>();
  for (const round of rounds) {
    const normalized = (samples.get(round.id) ?? []).flatMap((metric) => {
      const range = ranges.get(metric.key);
      if (!range || range.max === range.min) return [];
      const raw = (metric.value - range.min) / (range.max - range.min);
      return [{ ...metric, quality: metric.lowerIsBetter ? 1 - raw : raw }];
    }).sort((left, right) => right.quality - left.quality);
    if (!normalized.length) continue;
    const insights: RoundInsight[] = [];
    if (normalized[0].quality >= 0.5) insights.push({ tone: "strength", text: normalized[0].display });
    const weakest = normalized.at(-1);
    if (weakest && weakest.quality <= 0.5 && !insights.some((insight) => insight.text === weakest.display)) {
      insights.push({ tone: "focus", text: weakest.display });
    }
    if (insights.length) result.set(round.id, insights);
  }
  return result;
}
