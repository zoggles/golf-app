import { formatToPar } from "./metrics";
import {
  formatNoun,
  MIN_SAMPLES,
  rankLabel,
  type BaselineConfidence,
  type RoundBaselineKind,
  type RoundBaselines,
  type RoundRank,
} from "./personal-baseline";
import { holeList, type PersonalSummaryInput, type RoundReport, type ScoredHole } from "./round-report";
import { describeVsTarget, type RoundScorecard, type ScorecardHole } from "./round-scorecard";

/**
 * A finished round as a story: how it went against your usual game, which holes made or cost
 * the day, and the one change that would have saved the most strokes.
 *
 * Every number here comes from the scorecard, the round report or your baseline, and nothing
 * is estimated beyond them. "vs you" is exactly today's score minus the score you usually
 * make. It is not strokes gained, which needs a model of expected scores from every position
 * on the course, and it is never called that.
 */

export type Tone = "under" | "over" | "even";

/** Within this many strokes of your average counts as a normal day. */
export const EVEN_BAND = 0.5;

/** Today is at least this far from your average on a hole before it is called out. */
export const CALLOUT_THRESHOLD = 1;
export const MAX_CALLOUTS = 3;

/** An opportunity worth fewer strokes than this is noise, not a plan. */
export const OPPORTUNITY_MIN_STROKES = 2;

export function toneOf(value: number | null, band = 0): Tone | null {
  if (value === null) return null;
  if (value === 0 || Math.abs(value) < band) return "even";
  return value < 0 ? "under" : "over";
}

const tenth = (value: number) => Math.round(value * 10) / 10;
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** An average to one decimal: "6.1". */
export function formatAverage(value: number): string {
  return tenth(value).toFixed(1);
}

/** A difference from your average, signed, to one decimal: "-1.1", "+0.9", "0.0". */
export function formatVsAverage(value: number): string {
  const rounded = tenth(value);
  if (rounded === 0) return "0.0";
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}`;
}

/** "4.2 strokes", "4 strokes", "1 stroke". Always positive: the sentence says which way. */
export function formatStrokes(value: number): string {
  const rounded = tenth(Math.abs(value));
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} ${rounded === 1 ? "stroke" : "strokes"}`;
}

/** "Your avg", or "Your par-4 avg" when a hole borrows the average of its par. */
export function averageLabel(line: ScorecardHole): string {
  return line.history?.baseline?.source === "par-type" ? `Your par-${line.par} avg` : "Your avg";
}

// You vs you ------------------------------------------------------------------------------

export interface PersonalHeadline {
  /** The comparison used, or null while your baseline is still building. */
  basis: RoundBaselineKind | null;
  /** Strokes against your average. Negative is better. */
  delta: number | null;
  tone: Tone | null;
  /** The difference as shown beside the title: "-4.2", or "-9" for the rougher pace comparison. */
  value: string | null;
  /** "4.2 strokes better than your Arrowhead average" */
  title: string;
  /** What it was measured against, in numbers. */
  detail: string;
  confidence: BaselineConfidence;
}

/**
 * The single most useful "vs you" line for a round: against your rounds with the same holes
 * at this course when there are enough, then your rounds of the same length anywhere, then
 * your pace across every round. Until any of those has MIN_SAMPLES rounds, it says the
 * baseline is building and offers only plain facts, such as your score last time here.
 */
export function personalHeadline(baselines: RoundBaselines, courseName: string): PersonalHeadline {
  const { result } = baselines;
  if (!result) {
    return {
      basis: null,
      delta: null,
      tone: null,
      value: null,
      confidence: "building",
      title: "Finish every hole to compare",
      detail: "A round is compared with your average once every hole is on the card.",
    };
  }

  const pick = [baselines.course, baselines.format, baselines.pace].find(
    (baseline) => baseline.delta !== null && baseline.average !== null,
  );
  if (!pick || pick.delta === null || pick.average === null) {
    const parts: string[] = [];
    const last = baselines.course.last;
    if (last !== null) {
      const change = result.total - last;
      parts.push(change === 0
        ? `Same score as last time here (${last}).`
        : `${formatStrokes(change)} ${change < 0 ? "better" : "worse"} than last time here (${last}).`);
    }
    const needed = Math.max(1, MIN_SAMPLES - baselines.pace.samples);
    parts.push(baselines.pace.rounds === 0
      ? `This round starts your baseline. ${MIN_SAMPLES} finished rounds unlock your average.`
      : needed === 1
        ? "1 more finished round unlocks your average."
        : `${needed} more finished rounds unlock your average.`);
    return { basis: null, delta: null, tone: null, value: null, confidence: "building", title: "Building your baseline", detail: parts.join(" ") };
  }

  const delta = pick.delta;
  const tone = toneOf(delta, EVEN_BAND);
  const direction = delta < 0 ? "better" : "worse";
  const rounds = plural(pick.samples, "round");

  if (pick.kind === "course") {
    return {
      basis: "course",
      delta,
      tone,
      value: formatVsAverage(delta),
      title: tone === "even" ? `Right on your ${courseName} average` : `${formatStrokes(delta)} ${direction} than your ${courseName} average`,
      detail: `Average ${formatAverage(pick.average)} over your last ${rounds} here${pick.best !== null ? ` · Best ${pick.best}` : ""}`,
      confidence: pick.confidence,
    };
  }

  if (pick.kind === "format") {
    const length = formatNoun(result.holes, 1);
    return {
      basis: "format",
      delta,
      tone,
      value: formatVsAverage(delta),
      title: tone === "even" ? `Right on your usual ${length}` : `${formatStrokes(delta)} ${direction} than your usual ${length}`,
      detail: `Your ${formatNoun(result.holes, 2)} average ${formatVsAverage(pick.average)} vs par over the last ${rounds}${pick.best !== null ? ` · Best ${formatToPar(pick.best)}` : ""}`,
      confidence: pick.confidence,
    };
  }

  // Pace scales nines and eighteens to one another, so it is only ever "about" whole strokes.
  const whole = Math.round(Math.abs(delta));
  return {
    basis: "pace",
    delta,
    tone,
    value: formatToPar(delta < 0 ? -whole : whole),
    title: tone === "even" ? "Right on your usual scoring pace" : `About ${plural(whole, "stroke")} ${direction} than your usual pace`,
    detail: `From your strokes over par per hole across your last ${rounds}, nines and eighteens together`,
    confidence: pick.confidence,
  };
}

/** "Your best round at Arrowhead yet (3 played)" or "Your 3rd-best 18-hole round, out of 7". */
export function describeRank(
  rank: RoundRank,
  scope: "course" | "format",
  options: { courseName: string; holes: 9 | 18; later: boolean },
): string {
  const subject = scope === "course" ? `round at ${options.courseName}` : formatNoun(options.holes, 1);
  if (rank.position === 1) {
    const when = options.later ? "at the time" : "yet";
    return `${rank.tied ? "Tied for your best" : "Your best"} ${subject} ${when} (${rank.of} played)`;
  }
  return `Your ${rankLabel(rank.position)} ${subject}${options.later ? " at the time" : ""}${rank.tied ? " (tied)" : ""}, out of ${rank.of}`;
}

// Holes -----------------------------------------------------------------------------------

export interface HoleCallouts {
  /** Holes at least CALLOUT_THRESHOLD better than your average, biggest first. */
  wentWell: ScorecardHole[];
  /** Holes at least CALLOUT_THRESHOLD worse than your average, biggest first. */
  costYou: ScorecardHole[];
  /** Scored holes that had an average to compare with. */
  compared: number;
}

/** The holes that were unusually good or bad for you, ranked by strokes against your average. */
export function holeCallouts(card: RoundScorecard): HoleCallouts {
  const lines = card.nines.flatMap((nine) => nine.holes).filter((line) => line.vsAverage !== null);
  const borrowed = (line: ScorecardHole) => (line.history?.baseline?.source === "hole" ? 0 : 1);
  const bySize = (left: ScorecardHole, right: ScorecardHole) =>
    Math.abs(right.vsAverage ?? 0) - Math.abs(left.vsAverage ?? 0) ||
    borrowed(left) - borrowed(right) ||
    left.hole.number - right.hole.number;
  return {
    wentWell: lines.filter((line) => tenth(line.vsAverage ?? 0) <= -CALLOUT_THRESHOLD).sort(bySize).slice(0, MAX_CALLOUTS),
    costYou: lines.filter((line) => tenth(line.vsAverage ?? 0) >= CALLOUT_THRESHOLD).sort(bySize).slice(0, MAX_CALLOUTS),
    compared: lines.length,
  };
}

export interface WorstHole {
  line: ScorecardHole;
  /** "average" when the hole was measured against your own history, "par" otherwise. */
  basis: "average" | "par";
  delta: number;
}

/**
 * The hole that hurt most: the furthest over your own average when there is one to compare
 * with, or otherwise the furthest over par, as long as that was a triple bogey or worse.
 */
export function worstHole(card: RoundScorecard): WorstHole | null {
  const lines = card.nines.flatMap((nine) => nine.holes).filter((line) => line.score !== null);
  const vsAverage = lines
    .filter((line) => line.vsAverage !== null && tenth(line.vsAverage) >= CALLOUT_THRESHOLD)
    .sort((left, right) => (right.vsAverage ?? 0) - (left.vsAverage ?? 0) || left.hole.number - right.hole.number);
  if (vsAverage.length) return { line: vsAverage[0], basis: "average", delta: vsAverage[0].vsAverage ?? 0 };
  const vsPar = lines
    .filter((line) => (line.vsPar ?? 0) >= 3)
    .sort((left, right) => (right.vsPar ?? 0) - (left.vsPar ?? 0) || left.hole.number - right.hole.number);
  return vsPar.length ? { line: vsPar[0], basis: "par", delta: vsPar[0].vsPar ?? 0 } : null;
}

// What to work on ---------------------------------------------------------------------------

export type OpportunityKind = "blow-ups" | "penalties" | "three-putts" | "doubles" | "bogeys";

export interface Opportunity {
  kind: OpportunityKind;
  /** Strokes this one change would have saved today. */
  strokes: number;
  title: string;
  detail: string;
  /** Something to try next round. */
  next: string;
  holes: number[];
}

/** On a tie in strokes, the change a beginner can make soonest comes first. */
const PRIORITY: OpportunityKind[] = ["blow-ups", "penalties", "three-putts", "doubles", "bogeys"];

const numbers = (items: ScoredHole[]) => items.map((item) => item.hole.number);

/**
 * Where the strokes went, as changes ranked by how many they would have saved today.
 *
 * Each one is measured the same way, one step better: a triple or worse played as a double, a
 * double as a bogey, a bogey as a par, a penalty avoided, a three-putt holed in two. Putts and
 * penalties count only on holes where they were tracked. Which comes first is decided by the
 * round, never assumed.
 */
export function scoringOpportunities(report: RoundReport): Opportunity[] {
  const { holes } = report;
  const found: Opportunity[] = [];

  const blowUps = holes.filter((item) => item.toPar >= 3);
  if (blowUps.length) {
    const strokes = blowUps.reduce((total, item) => total + item.toPar - 2, 0);
    found.push({
      kind: "blow-ups",
      strokes,
      title: "Fewer blow-up holes",
      detail: `${plural(blowUps.length, "hole")} at triple bogey or worse cost ${formatStrokes(strokes)} more than double bogeys would have.`,
      next: "When a hole starts to go wrong, take the safe shot back into play and settle for a double.",
      holes: numbers(blowUps),
    });
  }

  const penalised = holes.filter((item) => (item.metrics.penaltyStrokes ?? 0) > 0);
  const penalties = penalised.reduce((total, item) => total + (item.metrics.penaltyStrokes ?? 0), 0);
  if (penalties) {
    found.push({
      kind: "penalties",
      strokes: penalties,
      title: "Keep the ball in play",
      detail: `${plural(penalties, "penalty stroke")} on ${holeList(numbers(penalised))}.`,
      next: "Off the tee, pick the club that keeps you out of trouble, even if it goes shorter.",
      holes: numbers(penalised),
    });
  }

  const threePutts = holes.filter((item) => (item.metrics.putts ?? 0) >= 3);
  if (threePutts.length) {
    const strokes = threePutts.reduce((total, item) => total + (item.metrics.putts ?? 0) - 2, 0);
    found.push({
      kind: "three-putts",
      strokes,
      title: "Fewer three-putts",
      detail: `${plural(threePutts.length, "three-putt")} or worse cost ${formatStrokes(strokes)} over two putts each.`,
      next: "Practise long putts so the first one finishes close enough to tap in.",
      holes: numbers(threePutts),
    });
  }

  const doubles = holes.filter((item) => item.toPar === 2);
  if (doubles.length) {
    found.push({
      kind: "doubles",
      strokes: doubles.length,
      title: "Turn doubles into bogeys",
      detail: `${plural(doubles.length, "double bogey", "double bogeys")}: a bogey on each would have saved ${formatStrokes(doubles.length)}.`,
      next: "On your hardest holes, play for bogey: two safe shots beat one hero shot.",
      holes: numbers(doubles),
    });
  }

  const bogeys = holes.filter((item) => item.toPar === 1);
  if (bogeys.length) {
    found.push({
      kind: "bogeys",
      strokes: bogeys.length,
      title: "Turn bogeys into pars",
      detail: `${plural(bogeys.length, "bogey")}: a par on each would have saved ${formatStrokes(bogeys.length)}.`,
      next: "These are won around the green. Chip to finish close and give yourself one putt.",
      holes: numbers(bogeys),
    });
  }

  return found
    .filter((item) => item.strokes >= OPPORTUNITY_MIN_STROKES)
    .sort((left, right) => right.strokes - left.strokes || PRIORITY.indexOf(left.kind) - PRIORITY.indexOf(right.kind));
}

// For the caddy -----------------------------------------------------------------------------

/** The personal story in plain lines, for the AI summary to draw on and never go beyond. */
export function buildPersonalSummary(request: {
  headline: PersonalHeadline;
  card: RoundScorecard;
  callouts: HoleCallouts;
  opportunity: Opportunity | null;
  ranks: string[];
  trend: string | null;
}): PersonalSummaryInput {
  const { headline, card, callouts, opportunity } = request;
  const hole = (line: ScorecardHole) =>
    `Hole ${line.hole.number}: ${line.score} today vs ${averageLabel(line).toLowerCase()} ${formatAverage(line.history?.baseline?.average ?? 0)} (${formatVsAverage(line.vsAverage ?? 0)} vs you)`;
  return {
    comparison: `${headline.title}. ${headline.detail}`,
    handicap: card.vsTarget === null || card.target === null ? null : `${describeVsTarget(card.vsTarget)} (target ${card.target})`,
    ranks: request.ranks,
    trend: request.trend,
    holesBetter: callouts.wentWell.map(hole),
    holesWorse: callouts.costYou.map(hole),
    biggestOpportunity: opportunity ? `${opportunity.title}. ${opportunity.detail}` : null,
  };
}
