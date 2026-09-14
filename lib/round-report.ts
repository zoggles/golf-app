import { getCourse, getSegmentHoles, segmentLabel } from "./courses";
import { formatToPar, holeMetricsByNumber } from "./metrics";
import type { GolfRound, Hole, HoleMetrics } from "./types";

/**
 * What a finished round says about the golf, as plain facts.
 *
 * The same facts feed the card on the round page and the AI summary, so the model is handed
 * numbers it can joke about but never numbers it made up. Stats that were never tracked stay
 * absent rather than becoming zero, the rule ./metrics already follows: "no penalties" is only
 * ever said about a round where penalties were actually being counted.
 */

export type ScoreType = "eagle" | "birdie" | "par" | "bogey" | "double" | "triple";

export const SCORE_TYPES: readonly ScoreType[] = ["eagle", "birdie", "par", "bogey", "double", "triple"];

export const SCORE_TYPE_NAMES: Record<ScoreType, { single: string; plural: string }> = {
  eagle: { single: "Eagle or better", plural: "Eagles" },
  birdie: { single: "Birdie", plural: "Birdies" },
  par: { single: "Par", plural: "Pars" },
  bogey: { single: "Bogey", plural: "Bogeys" },
  double: { single: "Double bogey", plural: "Doubles" },
  triple: { single: "Triple or worse", plural: "Triple+" },
};

export function scoreType(strokes: number, par: number): ScoreType {
  const toPar = strokes - par;
  if (toPar <= -2) return "eagle";
  if (toPar === -1) return "birdie";
  if (toPar === 0) return "par";
  if (toPar === 1) return "bogey";
  if (toPar === 2) return "double";
  return "triple";
}

export interface ScoredHole {
  hole: Hole;
  strokes: number;
  toPar: number;
  type: ScoreType;
  metrics: HoleMetrics;
}

/** Holes with a score, in playing order. `scores` lets an unsaved edit be previewed. */
export function scoredHoles(round: GolfRound, scores: Record<number, number> = round.scores): ScoredHole[] {
  const course = round.course ?? getCourse(round.courseId);
  const metrics = holeMetricsByNumber(round);
  return getSegmentHoles(course, round.segment).flatMap((hole) => {
    const strokes = scores[hole.number];
    if (strokes == null) return [];
    return [{
      hole,
      strokes,
      toPar: strokes - hole.par,
      type: scoreType(strokes, hole.par),
      metrics: metrics[hole.number] ?? {},
    }];
  });
}

export type ScoreMix = Record<ScoreType, number>;

export function scoreMix(holes: ScoredHole[]): ScoreMix {
  const mix: ScoreMix = { eagle: 0, birdie: 0, par: 0, bogey: 0, double: 0, triple: 0 };
  for (const item of holes) mix[item.type] += 1;
  return mix;
}

export interface ReportFact {
  key: string;
  text: string;
  /** Ranks facts against each other; only the heaviest few are shown. */
  weight: number;
}

export interface RoundRates {
  holes: number;
  toParPerHole: number;
  birdiesOrBetterRate: number;
  parsOrBetterRate: number;
  doublesOrWorseRate: number;
  fairwayRate: number | null;
  puttsPerHole: number | null;
  threePuttRate: number | null;
  penaltiesPerHole: number | null;
}

export interface RoundReport {
  holes: ScoredHole[];
  holesScored: number;
  total: number;
  par: number;
  toPar: number;
  mix: ScoreMix;
  wentWell: ReportFact[];
  costYou: ReportFact[];
  rates: RoundRates;
}

/** Enough to scan at a glance; past this a list stops being "quick". */
export const MAX_FACTS = 4;

const numberOf = (item: ScoredHole) => item.hole.number;
const percent = (rate: number) => `${Math.round(rate * 100)}%`;
const sumToPar = (items: ScoredHole[]) => items.reduce((total, item) => total + item.toPar, 0);

function holeList(numbers: number[]): string {
  if (numbers.length === 1) return `hole ${numbers[0]}`;
  if (numbers.length > 4) return `${numbers.length} holes`;
  return `holes ${numbers.slice(0, -1).join(", ")} and ${numbers[numbers.length - 1]}`;
}

function times(count: number): string {
  if (count === 1) return "once";
  if (count === 2) return "twice";
  return `${count} times`;
}

function averageToPar(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return "even par";
  return rounded > 0 ? `+${rounded.toFixed(1)}` : rounded.toFixed(1);
}

/** Two holes are a run only if nothing was skipped between them. */
function follows(previous: ScoredHole, next: ScoredHole): boolean {
  return next.hole.number === previous.hole.number + 1;
}

function longestRun(holes: ScoredHole[], test: (item: ScoredHole) => boolean) {
  let best = { length: 0, from: 0, to: 0 };
  let start = -1;
  holes.forEach((item, index) => {
    const continues = index > 0 && start >= 0 && follows(holes[index - 1], item);
    if (!test(item)) {
      start = -1;
      return;
    }
    if (!continues) start = index;
    const length = index - start + 1;
    if (length > best.length) best = { length, from: holes[start].hole.number, to: item.hole.number };
  });
  return best;
}

/** A bogey or worse answered straight away by par or better. */
function countBounceBacks(holes: ScoredHole[]): number {
  let count = 0;
  for (let index = 1; index < holes.length; index += 1) {
    const before = holes[index - 1];
    const after = holes[index];
    if (follows(before, after) && before.toPar >= 1 && after.toPar <= 0) count += 1;
  }
  return count;
}

function byWeight(facts: ReportFact[]): ReportFact[] {
  return [...facts].sort((left, right) => right.weight - left.weight).slice(0, MAX_FACTS);
}

export function buildRoundReport(round: GolfRound, scores: Record<number, number> = round.scores): RoundReport {
  const holes = scoredHoles(round, scores);
  const count = holes.length;
  const total = holes.reduce((sum, item) => sum + item.strokes, 0);
  const par = holes.reduce((sum, item) => sum + item.hole.par, 0);
  const mix = scoreMix(holes);
  const wentWell: ReportFact[] = [];
  const costYou: ReportFact[] = [];

  const eagles = holes.filter((item) => item.type === "eagle");
  const birdies = holes.filter((item) => item.type === "birdie");
  const parsOrBetter = holes.filter((item) => item.toPar <= 0).length;
  const blowUps = holes.filter((item) => item.toPar >= 2);

  if (eagles.length) {
    wentWell.push({
      key: "eagles",
      weight: 160 + eagles.length * 20,
      text: `${eagles.length === 1 ? "An eagle" : `${eagles.length} eagles`} on ${holeList(eagles.map(numberOf))}`,
    });
  }
  if (birdies.length) {
    wentWell.push({
      key: "birdies",
      weight: 110 + birdies.length * 12,
      text: `${birdies.length === 1 ? "A birdie" : `${birdies.length} birdies`} on ${holeList(birdies.map(numberOf))}`,
    });
  }
  if (count >= 9 && blowUps.length === 0) {
    wentWell.push({ key: "no-doubles", weight: 120, text: "Not a single double bogey all round" });
  }
  if (parsOrBetter > 0) {
    wentWell.push({
      key: "pars-or-better",
      weight: 40 + (parsOrBetter / count) * 60,
      text: `${parsOrBetter} of ${count} holes at par or better`,
    });
  }
  const streak = longestRun(holes, (item) => item.toPar <= 0);
  if (streak.length >= 3) {
    wentWell.push({
      key: "streak",
      weight: 60 + streak.length * 6,
      text: `${streak.length} straight holes at par or better (${streak.from}–${streak.to})`,
    });
  }
  const bounceBacks = countBounceBacks(holes);
  if (bounceBacks > 0) {
    wentWell.push({
      key: "bounce-backs",
      weight: 50 + bounceBacks * 8,
      text: `Bounced back with par or better ${times(bounceBacks)} after a bogey or worse`,
    });
  }

  if (blowUps.length) {
    costYou.push({
      key: "blow-ups",
      weight: 100 + sumToPar(blowUps) * 6,
      text: `${blowUps.length === 1 ? "A double or worse" : `${blowUps.length} doubles or worse`} on ${holeList(blowUps.map(numberOf))}, ${formatToPar(sumToPar(blowUps))} on those holes alone`,
    });
  }
  const worst = holes.reduce<ScoredHole | null>((current, item) => (!current || item.toPar > current.toPar ? item : current), null);
  if (worst && worst.toPar >= 3) {
    costYou.push({
      key: "worst-hole",
      weight: 70 + worst.toPar * 6,
      text: `Hole ${worst.hole.number}: ${worst.strokes} on a par ${worst.hole.par}`,
    });
  }
  const slide = longestRun(holes, (item) => item.toPar >= 1);
  if (slide.length >= 3) {
    costYou.push({
      key: "slide",
      weight: 55 + slide.length * 5,
      text: `${slide.length} straight holes over par (${slide.from}–${slide.to})`,
    });
  }

  const fairways = holes.filter((item) => item.metrics.fairway !== undefined);
  const fairwaysHit = fairways.filter((item) => item.metrics.fairway === "hit").length;
  const fairwayRate = fairways.length ? fairwaysHit / fairways.length : null;
  if (fairwayRate !== null && fairways.length >= 3) {
    if (fairwayRate >= 0.5) {
      wentWell.push({ key: "fairways", weight: 45 + fairwayRate * 30, text: `Hit ${fairwaysHit} of ${fairways.length} fairways (${percent(fairwayRate)})` });
    } else {
      costYou.push({ key: "fairways", weight: 45 + (1 - fairwayRate) * 30, text: `Missed ${fairways.length - fairwaysHit} of ${fairways.length} fairways` });
    }
  }

  const putted = holes.filter((item) => item.metrics.putts !== undefined);
  const putts = putted.reduce((sum, item) => sum + (item.metrics.putts ?? 0), 0);
  const onePutts = putted.filter((item) => item.metrics.putts === 1).length;
  const threePutts = putted.filter((item) => (item.metrics.putts ?? 0) >= 3);
  if (onePutts) {
    wentWell.push({ key: "one-putts", weight: 50 + onePutts * 8, text: `${onePutts === 1 ? "A one-putt" : `${onePutts} one-putts`}` });
  }
  if (threePutts.length) {
    costYou.push({
      key: "three-putts",
      weight: 70 + threePutts.length * 12,
      text: `${threePutts.length === 1 ? "A three-putt" : `${threePutts.length} three-putts`} on ${holeList(threePutts.map(numberOf))}`,
    });
  }

  const penaltyTracked = holes.filter((item) => item.metrics.penaltyStrokes !== undefined);
  const penalties = penaltyTracked.reduce((sum, item) => sum + (item.metrics.penaltyStrokes ?? 0), 0);
  if (penaltyTracked.length) {
    if (penalties > 0) {
      costYou.push({ key: "penalties", weight: 75 + penalties * 10, text: `${penalties === 1 ? "A penalty stroke" : `${penalties} penalty strokes`} handed away` });
    } else if (penaltyTracked.length >= 9) {
      wentWell.push({ key: "no-penalties", weight: 40, text: "No penalty strokes" });
    }
  }

  if (round.segment === "full18" && count === 18) {
    const front = sumToPar(holes.filter((item) => item.hole.number <= 9));
    const back = sumToPar(holes.filter((item) => item.hole.number >= 10));
    const gap = back - front;
    if (Math.abs(gap) >= 3) {
      costYou.push({
        key: "nines",
        weight: 40 + Math.abs(gap) * 4,
        text: gap > 0
          ? `Faded on the back nine: ${formatToPar(back)} after ${formatToPar(front)} on the front`
          : `Slow start: ${formatToPar(front)} on the front, ${formatToPar(back)} on the back`,
      });
    }
  }

  const byPar = new Map<number, ScoredHole[]>();
  for (const item of holes) byPar.set(item.hole.par, [...(byPar.get(item.hole.par) ?? []), item]);
  const parTypes = [...byPar.entries()]
    .filter(([, items]) => items.length >= 2)
    .map(([holePar, items]) => ({ holePar, average: sumToPar(items) / items.length }))
    .sort((left, right) => left.average - right.average);
  if (parTypes.length >= 2) {
    const best = parTypes[0];
    const weakest = parTypes[parTypes.length - 1];
    if (best.average <= 0.5) {
      wentWell.push({ key: "best-par-type", weight: 30 + (1 - best.average) * 10, text: `Par ${best.holePar}s at ${averageToPar(best.average)} a hole` });
    }
    if (weakest.average >= 1) {
      costYou.push({ key: "worst-par-type", weight: 35 + weakest.average * 8, text: `Par ${weakest.holePar}s averaged ${averageToPar(weakest.average)} a hole` });
    }
  }

  return {
    holes,
    holesScored: count,
    total,
    par,
    toPar: total - par,
    mix,
    wentWell: byWeight(wentWell),
    costYou: byWeight(costYou),
    rates: {
      holes: count,
      toParPerHole: count ? (total - par) / count : 0,
      birdiesOrBetterRate: count ? (eagles.length + birdies.length) / count : 0,
      parsOrBetterRate: count ? parsOrBetter / count : 0,
      doublesOrWorseRate: count ? blowUps.length / count : 0,
      fairwayRate,
      puttsPerHole: putted.length ? putts / putted.length : null,
      threePuttRate: putted.length ? threePutts.length / putted.length : null,
      penaltiesPerHole: penaltyTracked.length ? penalties / penaltyTracked.length : null,
    },
  };
}

function roundTime(round: GolfRound): number {
  return new Date(round.completedAt ?? round.startedAt).getTime();
}

/** Completed rounds played before this one, newest first. */
export function previousCompletedRounds(rounds: GolfRound[], round: GolfRound, limit = 5): GolfRound[] {
  const playedAt = roundTime(round);
  return rounds
    .filter((candidate) => candidate.id !== round.id && candidate.status === "completed" && roundTime(candidate) < playedAt)
    .sort((left, right) => roundTime(right) - roundTime(left))
    .slice(0, limit);
}

type ComparableKey = Exclude<keyof RoundRates, "holes">;

const COMPARABLE: Array<{ key: ComparableKey; label: string; lowerIsBetter: boolean; threshold: number }> = [
  { key: "toParPerHole", label: "Score against par", lowerIsBetter: true, threshold: 0.08 },
  { key: "parsOrBetterRate", label: "Holes at par or better", lowerIsBetter: false, threshold: 0.05 },
  { key: "birdiesOrBetterRate", label: "Birdie rate", lowerIsBetter: false, threshold: 0.03 },
  { key: "doublesOrWorseRate", label: "Doubles or worse", lowerIsBetter: true, threshold: 0.05 },
  { key: "fairwayRate", label: "Fairways hit", lowerIsBetter: false, threshold: 0.08 },
  { key: "puttsPerHole", label: "Putts per hole", lowerIsBetter: true, threshold: 0.1 },
  { key: "threePuttRate", label: "Three-putts", lowerIsBetter: true, threshold: 0.05 },
  { key: "penaltiesPerHole", label: "Penalty strokes", lowerIsBetter: true, threshold: 0.05 },
];

export interface MetricDelta {
  key: ComparableKey;
  label: string;
  current: number;
  previous: number;
}

export interface RoundComparison {
  previousCount: number;
  improving: MetricDelta[];
  slipping: MetricDelta[];
}

/**
 * How this round moved against the ones before it, per hole so nine- and eighteen-hole
 * rounds compare fairly. A change smaller than the metric's threshold is noise and is left
 * out, so one lucky putt does not get reported as a trend.
 */
export function compareToPrevious(current: RoundReport, previous: RoundReport[]): RoundComparison {
  const usable = previous.filter((report) => report.holesScored >= 9);
  const improving: Array<MetricDelta & { size: number }> = [];
  const slipping: Array<MetricDelta & { size: number }> = [];

  for (const metric of COMPARABLE) {
    const now = current.rates[metric.key];
    if (now === null) continue;
    let weighted = 0;
    let weight = 0;
    for (const report of usable) {
      const value = report.rates[metric.key];
      if (value === null) continue;
      weighted += value * report.rates.holes;
      weight += report.rates.holes;
    }
    if (weight === 0) continue;
    const before = weighted / weight;
    const change = now - before;
    if (Math.abs(change) < metric.threshold) continue;
    const better = metric.lowerIsBetter ? change < 0 : change > 0;
    const entry = { key: metric.key, label: metric.label, current: now, previous: before, size: Math.abs(change) / metric.threshold };
    (better ? improving : slipping).push(entry);
  }

  const strip = (items: Array<MetricDelta & { size: number }>) =>
    items.sort((left, right) => right.size - left.size).map((item) => ({
      key: item.key,
      label: item.label,
      current: item.current,
      previous: item.previous,
    }));
  return { previousCount: usable.length, improving: strip(improving), slipping: strip(slipping) };
}

function describeRate(key: ComparableKey, value: number): string {
  if (key === "toParPerHole") return `${formatToPar(Math.round(value * 18 * 10) / 10)} per 18`;
  if (key === "puttsPerHole" || key === "penaltiesPerHole") return value.toFixed(2);
  return percent(value);
}

export function describeDelta(delta: MetricDelta): string {
  return `${delta.label}: ${describeRate(delta.key, delta.current)} now vs ${describeRate(delta.key, delta.previous)} before`;
}

export interface SummaryInput {
  course: string;
  segment: string;
  playedOn: string;
  score: { total: number; par: number; toPar: string; holes: number };
  scoreMix: Record<string, number>;
  wentWell: string[];
  costYou: string[];
  history: { previousRounds: number; improving: string[]; slipping: string[] };
}

/** Everything the summary model is allowed to know, and nothing it could embellish. */
export function buildSummaryInput(round: GolfRound, report: RoundReport, comparison: RoundComparison): SummaryInput {
  return {
    course: round.courseName,
    segment: segmentLabel(round.segment),
    playedOn: new Date(round.completedAt ?? round.startedAt).toISOString().slice(0, 10),
    score: { total: report.total, par: report.par, toPar: formatToPar(report.toPar), holes: report.holesScored },
    scoreMix: Object.fromEntries(SCORE_TYPES.map((type) => [SCORE_TYPE_NAMES[type].plural, report.mix[type]])),
    wentWell: report.wentWell.map((fact) => fact.text),
    costYou: report.costYou.map((fact) => fact.text),
    history: {
      previousRounds: comparison.previousCount,
      improving: comparison.improving.map(describeDelta),
      slipping: comparison.slipping.map(describeDelta),
    },
  };
}

/** Bump when the summary prompt or its input changes shape, so stored summaries refresh. */
export const SUMMARY_VERSION = 1;

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function canonicalScores(scores: Record<number, number>): Array<[number, number]> {
  return Object.keys(scores)
    .map(Number)
    .sort((left, right) => left - right)
    .map((hole) => [hole, scores[hole]]);
}

/**
 * Identifies exactly what a stored summary was written about. Editing a score, a tracked
 * stat, or any of the rounds it was compared against changes this, and the summary is
 * written again rather than quoting numbers that are no longer true.
 */
export function roundSummaryFingerprint(round: GolfRound, previous: GolfRound[]): string {
  const metrics = holeMetricsByNumber(round);
  return fnv1a(JSON.stringify({
    version: SUMMARY_VERSION,
    id: round.id,
    segment: round.segment,
    scores: canonicalScores(round.scores),
    metrics: Object.keys(metrics)
      .map(Number)
      .sort((left, right) => left - right)
      .map((hole) => [hole, metrics[hole].putts ?? null, metrics[hole].penaltyStrokes ?? null, metrics[hole].fairway ?? null, metrics[hole].blowUp ?? null]),
    previous: previous.map((item) => [item.id, canonicalScores(item.scores)]),
  }));
}
