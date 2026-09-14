import { getCourse, getSegmentHoles } from "./courses";
import { estimateHandicap, estimateRoundHandicap, handicapStrokesForHole } from "./metrics";
import type { HoleHistory } from "./personal-baseline";
import { litHalves } from "./round-format";
import { previousCompletedRounds, scoreType, type ScoreType } from "./round-report";
import type { GolfRound, Hole } from "./types";

/**
 * A finished round hole by hole, against the three things a score can be measured by.
 *
 * - Par: what the course expects of any golfer.
 * - Handicap target: par plus the strokes your handicap gives you, one hole at a time from the
 *   hardest. It uses the handicap carried into the round rather than today's, so an early
 *   round is judged by the golfer who played it.
 * - Your average: what you usually take on the hole, from ./personal-baseline.
 *
 * They answer different questions and are kept apart on purpose. Par is how you compare to
 * golf, the handicap target how you compare competitively, and your average whether you are
 * getting better.
 */

/** The handicap index from every completed round played before this one. */
export function handicapGoingInto(rounds: GolfRound[], round: GolfRound): number | null {
  return estimateHandicap(previousCompletedRounds(rounds, round, Number.POSITIVE_INFINITY));
}

export interface ScorecardHole {
  hole: Hole;
  par: number;
  score: number | null;
  type: ScoreType | null;
  vsPar: number | null;
  /** Strokes the round handicap gives on this hole. Zero when there is no handicap yet. */
  strokesReceived: number;
  /** Par plus strokesReceived: the score that plays to your handicap. */
  target: number | null;
  vsTarget: number | null;
  /** Your history on this hole, when the scorecard was built with it. */
  history: HoleHistory | null;
  /** Today against what you usually take here. Negative is better. */
  vsAverage: number | null;
}

export interface ScorecardTotals {
  par: number;
  score: number | null;
  vsPar: number | null;
  target: number | null;
  vsTarget: number | null;
  /** Your averages added up, only when every hole has one. */
  average: number | null;
  /** Today against your averages, only when every scored hole has one to compare with. */
  vsAverage: number | null;
}

export interface ScorecardNine extends ScorecardTotals {
  label: "Out" | "In";
  holes: ScorecardHole[];
}

export interface RoundScorecard extends ScorecardTotals {
  handicapIndex: number | null;
  roundHandicap: number | null;
  nines: ScorecardNine[];
  /** Scored holes with an average to compare against. */
  comparedHoles: number;
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

function totals(holes: ScorecardHole[]): ScorecardTotals {
  const scored = holes.filter((line) => line.score !== null);
  const targeted = holes.every((line) => line.target !== null);
  const averaged = holes.every((line) => Boolean(line.history?.baseline));
  const compared = scored.length > 0 && scored.every((line) => line.vsAverage !== null);
  return {
    par: sum(holes.map((line) => line.par)),
    score: scored.length ? sum(scored.map((line) => line.score ?? 0)) : null,
    vsPar: scored.length ? sum(scored.map((line) => line.vsPar ?? 0)) : null,
    target: targeted ? sum(holes.map((line) => line.target ?? 0)) : null,
    vsTarget: targeted && scored.length ? sum(scored.map((line) => line.vsTarget ?? 0)) : null,
    average: averaged ? sum(holes.map((line) => line.history?.baseline?.average ?? 0)) : null,
    vsAverage: compared ? sum(scored.map((line) => line.vsAverage ?? 0)) : null,
  };
}

/**
 * The round as a card: par, handicap target, your average and today for every hole, split
 * Out and In. `scores` lets an unsaved correction show before it is saved, and `history`,
 * from `buildHoleHistory`, adds your averages.
 */
export function buildRoundScorecard(request: {
  round: GolfRound;
  handicapIndex: number | null;
  scores?: Record<number, number>;
  history?: Map<number, HoleHistory>;
}): RoundScorecard {
  const { round, handicapIndex } = request;
  const scores = request.scores ?? round.scores;
  const course = round.course ?? getCourse(round.courseId);
  const holes = getSegmentHoles(course, round.segment);
  const roundHandicap = estimateRoundHandicap(handicapIndex, course, round.segment);

  const lines: ScorecardHole[] = holes.map((hole) => {
    const strokesReceived = roundHandicap === null ? 0 : handicapStrokesForHole(roundHandicap, hole, holes);
    const target = roundHandicap === null ? null : hole.par + strokesReceived;
    const score = scores[hole.number] ?? null;
    const history = request.history?.get(hole.number) ?? null;
    return {
      hole,
      par: hole.par,
      score,
      type: score === null ? null : scoreType(score, hole.par),
      vsPar: score === null ? null : score - hole.par,
      strokesReceived,
      target,
      vsTarget: score === null || target === null ? null : score - target,
      history,
      vsAverage: score === null || !history?.baseline ? null : score - history.baseline.average,
    };
  });

  // Split by position, as a paper card does, so a scorecard numbered differently still reads
  // as a first and second nine. A nine-hole round is Out or In by which half it covers.
  const nines: ScorecardNine[] = lines.length >= 18
    ? [
        { label: "Out", holes: lines.slice(0, 9), ...totals(lines.slice(0, 9)) },
        { label: "In", holes: lines.slice(9), ...totals(lines.slice(9)) },
      ]
    : [{
        label: litHalves(round.segment, lines.length).back && lines.length <= 9 ? "In" : "Out",
        holes: lines,
        ...totals(lines),
      }];

  return {
    handicapIndex,
    roundHandicap,
    nines,
    comparedHoles: lines.filter((line) => line.vsAverage !== null).length,
    ...totals(lines),
  };
}

/** "6 strokes under your handicap target", "1 stroke over…", or "Right on your handicap target". */
export function describeVsTarget(value: number): string {
  if (value === 0) return "Right on your handicap target";
  const strokes = Math.abs(value);
  return `${strokes} ${strokes === 1 ? "stroke" : "strokes"} ${value < 0 ? "under" : "over"} your handicap target`;
}
