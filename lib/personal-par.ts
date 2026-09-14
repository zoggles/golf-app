import { getCourse, getSegmentHoles } from "./courses";
import { estimateHandicap, estimateRoundHandicap, handicapStrokesForHole } from "./metrics";
import { litHalves } from "./round-format";
import { previousCompletedRounds, scoreType, type ScoreType } from "./round-report";
import type { GolfRound, Hole } from "./types";

/**
 * What a round should have taken: for the course, and for you.
 *
 * Par is what the course expects. Your par adds the strokes your handicap gives you, one hole
 * at a time from the hardest, which is what makes a bogey on the toughest hole a good score
 * for most golfers. It is measured against the handicap carried into the round rather than
 * today's, so an early round is judged by the golfer who played it, not by how much better
 * that golfer has become since.
 */

/** The handicap index from every completed round played before this one. */
export function handicapGoingInto(rounds: GolfRound[], round: GolfRound): number | null {
  return estimateHandicap(previousCompletedRounds(rounds, round, Number.POSITIVE_INFINITY));
}

export interface HoleLine {
  hole: Hole;
  par: number;
  /** Strokes the round handicap gives on this hole. Zero when there is no handicap yet. */
  strokesReceived: number;
  yourPar: number | null;
  score: number | null;
  type: ScoreType | null;
  vsPar: number | null;
  vsYourPar: number | null;
}

export interface NineLine {
  label: "Out" | "In";
  holes: HoleLine[];
  par: number;
  yourPar: number | null;
  score: number | null;
  vsPar: number | null;
  vsYourPar: number | null;
}

export interface PersonalScorecard {
  handicapIndex: number | null;
  roundHandicap: number | null;
  nines: NineLine[];
  par: number;
  yourPar: number | null;
  score: number | null;
  vsPar: number | null;
  vsYourPar: number | null;
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

function totals(holes: HoleLine[]) {
  const scored = holes.filter((line) => line.score !== null);
  const personal = holes.every((line) => line.yourPar !== null);
  return {
    par: sum(holes.map((line) => line.par)),
    yourPar: personal ? sum(holes.map((line) => line.yourPar ?? 0)) : null,
    score: scored.length ? sum(scored.map((line) => line.score ?? 0)) : null,
    vsPar: scored.length ? sum(scored.map((line) => line.vsPar ?? 0)) : null,
    vsYourPar: personal && scored.length ? sum(scored.map((line) => line.vsYourPar ?? 0)) : null,
  };
}

/**
 * The round as a paper card: par, your par and shots for every hole, split Out and In.
 * `scores` lets an unsaved correction show before it is saved.
 */
export function buildPersonalScorecard(request: {
  round: GolfRound;
  handicapIndex: number | null;
  scores?: Record<number, number>;
}): PersonalScorecard {
  const { round, handicapIndex } = request;
  const scores = request.scores ?? round.scores;
  const course = round.course ?? getCourse(round.courseId);
  const holes = getSegmentHoles(course, round.segment);
  const roundHandicap = estimateRoundHandicap(handicapIndex, course, round.segment);

  const lines: HoleLine[] = holes.map((hole) => {
    const strokesReceived = roundHandicap === null ? 0 : handicapStrokesForHole(roundHandicap, hole, holes);
    const yourPar = roundHandicap === null ? null : hole.par + strokesReceived;
    const score = scores[hole.number] ?? null;
    return {
      hole,
      par: hole.par,
      strokesReceived,
      yourPar,
      score,
      type: score === null ? null : scoreType(score, hole.par),
      vsPar: score === null ? null : score - hole.par,
      vsYourPar: score === null || yourPar === null ? null : score - yourPar,
    };
  });

  // Split by position, as a paper card does, so a scorecard numbered differently still reads
  // as a first and second nine. A nine-hole round is Out or In by which half it covers.
  const nines: NineLine[] = lines.length >= 18
    ? [
        { label: "Out", holes: lines.slice(0, 9), ...totals(lines.slice(0, 9)) },
        { label: "In", holes: lines.slice(9), ...totals(lines.slice(9)) },
      ]
    : [{
        label: litHalves(round.segment, lines.length).back && lines.length <= 9 ? "In" : "Out",
        holes: lines,
        ...totals(lines),
      }];

  return { handicapIndex, roundHandicap, nines, ...totals(lines) };
}

/** "6 strokes under your par", "1 stroke over your par", or "Right on your par". */
export function describeVsYourPar(value: number): string {
  if (value === 0) return "Right on your par";
  const strokes = Math.abs(value);
  return `${strokes} ${strokes === 1 ? "stroke" : "strokes"} ${value < 0 ? "under" : "over"} your par`;
}
