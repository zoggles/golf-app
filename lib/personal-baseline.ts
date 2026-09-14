import { normalizeLocation } from "./course-location";
import { getCourse, getSegmentHoles } from "./courses";
import { previousCompletedRounds } from "./round-report";
import { normalizeTee, samePhysicalCourse } from "./tee-selection";
import type { Course, GolfRound, Hole, RoundSegment } from "./types";

/**
 * Your baseline: how you usually score, taken only from rounds you have stored.
 *
 * Par says how you compare to golf and a handicap how you compare competitively. The baseline
 * says whether you are getting better, which for most beginners is the question that matters.
 * Three rules keep it honest:
 *
 * - Only rounds finished before the one being judged count, so a round is never measured
 *   against itself or against golf played after it.
 * - Averages look back over a rolling window of recent play, so the baseline follows a golfer
 *   who improves instead of anchoring them to their first rounds.
 * - Nothing is averaged from fewer than MIN_SAMPLES scores. Until then the baseline is
 *   "building", and callers say so rather than show an average of one or two rounds.
 */

export type BaselineConfidence = "building" | "early" | "solid" | "strong";

/** Fewest scores an average is built from before it is shown at all. */
export const MIN_SAMPLES = 3;

/** How many recent plays of a hole, or rounds, an average looks back over. */
export const BASELINE_WINDOW = 10;

/**
 * A hole played too rarely to have its own average borrows your average for holes of the same
 * par. That is a broader guess, so it needs more scores and more than one round behind it.
 */
const PAR_TYPE_MIN_SAMPLES = 6;
const PAR_TYPE_MIN_ROUNDS = 2;
const PAR_TYPE_WINDOW = 30;

/** Fewest rounds of one length before a scoring trend is read. */
export const TREND_MIN_ROUNDS = 4;

export function confidenceFor(samples: number): BaselineConfidence {
  if (samples < MIN_SAMPLES) return "building";
  if (samples < 5) return "early";
  if (samples < BASELINE_WINDOW) return "solid";
  return "strong";
}

export const CONFIDENCE_LABELS: Record<BaselineConfidence, string> = {
  building: "Building",
  early: "Early read",
  solid: "Solid",
  strong: "Strong",
};

const courseOf = (round: GolfRound): Course => round.course ?? getCourse(round.courseId);
const mean = (values: number[]) => values.reduce((total, value) => total + value, 0) / values.length;
const playedAt = (round: GolfRound) => new Date(round.completedAt ?? round.startedAt).getTime();
const parOf = (holes: Hole[]) => holes.reduce((total, hole) => total + hole.par, 0);

/** Completed rounds finished before this one, newest first: everything a baseline may use. */
export function historyBefore(rounds: GolfRound[], round: GolfRound): GolfRound[] {
  return previousCompletedRounds(rounds, round, Number.POSITIVE_INFINITY);
}

/** "18-hole round" or "9-hole rounds". */
export function formatNoun(holes: 9 | 18, count: number): string {
  return `${holes}-hole ${count === 1 ? "round" : "rounds"}`;
}

const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** Small counts as words, so "your last five 18-hole rounds" never reads as "5 18-hole". */
export function countWord(count: number): string {
  return COUNT_WORDS[count] ?? String(count);
}

/** Whether any round was finished after this one, so a rank can say "at the time". */
export function playedLater(rounds: GolfRound[], round: GolfRound): boolean {
  const time = playedAt(round);
  return rounds.some((item) => item.id !== round.id && item.status === "completed" && playedAt(item) > time);
}

/** "best", "2nd-best", "3rd-best", "11th-best". */
export function rankLabel(position: number): string {
  if (position === 1) return "best";
  const lastTwo = position % 100;
  const suffix = lastTwo >= 11 && lastTwo <= 13
    ? "th"
    : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[position % 10] ?? "th";
  return `${position}${suffix}-best`;
}

// Holes ---------------------------------------------------------------------------------------

export type HoleBaselineSource = "hole" | "par-type";

export interface HoleBaseline {
  /** "hole" is this hole at this course. "par-type" is every hole of the same par, anywhere. */
  source: HoleBaselineSource;
  /** Strokes you usually take. */
  average: number;
  /** Scores the average is built from. */
  samples: number;
  confidence: BaselineConfidence;
}

export interface HoleHistory {
  /** Times you played this hole before this round. */
  plays: number;
  /** Your lowest score on it before this round. */
  best: number | null;
  /** Your score the last time you played it. */
  last: number | null;
  /** What today is compared with, or null while there is too little history to say. */
  baseline: HoleBaseline | null;
}

interface PlayedHole {
  hole: Hole;
  strokes: number;
}

function playedHoles(round: GolfRound): PlayedHole[] {
  return getSegmentHoles(courseOf(round), round.segment).flatMap((hole) => {
    const strokes = round.scores[hole.number];
    return strokes == null ? [] : [{ hole, strokes }];
  });
}

/**
 * Your history on every hole of this round.
 *
 * A hole is the same hole at the same physical course, whichever tee, with the same number and
 * the same par; a different par means a different layout, whose scores would mislead. `history`
 * is newest first, as `historyBefore` returns it.
 */
export function buildHoleHistory(history: GolfRound[], round: GolfRound): Map<number, HoleHistory> {
  const course = courseOf(round);
  const past = history.map((item) => ({
    id: item.id,
    here: samePhysicalCourse(courseOf(item), course),
    holes: playedHoles(item),
  }));
  const result = new Map<number, HoleHistory>();

  for (const hole of getSegmentHoles(course, round.segment)) {
    const scores = past.flatMap((entry) => entry.here
      ? entry.holes.filter((item) => item.hole.number === hole.number && item.hole.par === hole.par).map((item) => item.strokes)
      : []);
    const plays = scores.length;
    const recent = scores.slice(0, BASELINE_WINDOW);
    let baseline: HoleBaseline | null = null;

    if (recent.length >= MIN_SAMPLES) {
      baseline = { source: "hole", average: mean(recent), samples: recent.length, confidence: confidenceFor(recent.length) };
    } else {
      const samePar = past
        .flatMap((entry) => entry.holes
          .filter((item) => item.hole.par === hole.par)
          .map((item) => ({ id: entry.id, toPar: item.strokes - item.hole.par })))
        .slice(0, PAR_TYPE_WINDOW);
      const rounds = new Set(samePar.map((item) => item.id)).size;
      if (samePar.length >= PAR_TYPE_MIN_SAMPLES && rounds >= PAR_TYPE_MIN_ROUNDS) {
        baseline = {
          source: "par-type",
          average: hole.par + mean(samePar.map((item) => item.toPar)),
          samples: samePar.length,
          // Borrowed from other holes, so it never reads as more than an early guess.
          confidence: "early",
        };
      }
    }

    result.set(hole.number, {
      plays,
      best: plays ? Math.min(...scores) : null,
      last: plays ? scores[0] : null,
      baseline,
    });
  }
  return result;
}

// Rounds --------------------------------------------------------------------------------------

export interface RoundResult {
  total: number;
  par: number;
  toPar: number;
  holes: 9 | 18;
}

/** A round's score when every hole of its nine or eighteen is on the card; null otherwise. */
export function completeResult(round: GolfRound, scores: Record<number, number> = round.scores): RoundResult | null {
  const holes = getSegmentHoles(courseOf(round), round.segment);
  if (holes.length !== 9 && holes.length !== 18) return null;
  if (holes.some((hole) => scores[hole.number] == null)) return null;
  const total = holes.reduce((sum, hole) => sum + scores[hole.number], 0);
  const par = parOf(holes);
  return { total, par, toPar: total - par, holes: holes.length };
}

/**
 * The same holes at the same course: one physical course whatever the tee, the same nine or
 * eighteen, and the same par. Only rounds that share this are compared stroke for stroke.
 */
export function layoutKey(round: GolfRound): string {
  const course = courseOf(round);
  return [
    normalizeTee(course.name),
    normalizeLocation(course.location),
    round.segment,
    parOf(getSegmentHoles(course, round.segment)),
  ].join("|");
}

function finished(rounds: GolfRound[]): Array<{ round: GolfRound; key: string; result: RoundResult }> {
  return rounds.flatMap((round) => {
    const result = round.status === "completed" ? completeResult(round) : null;
    return result ? [{ round, key: layoutKey(round), result }] : [];
  });
}

export type RoundBaselineKind = "course" | "format" | "pace";

export interface RoundBaseline {
  kind: RoundBaselineKind;
  /** Comparable rounds before this one, however many the average used. */
  rounds: number;
  /** Rounds the average is built from: the most recent, up to BASELINE_WINDOW. */
  samples: number;
  confidence: BaselineConfidence;
  /**
   * Null while building. The scale depends on the kind: strokes for "course", which compares
   * the same holes; strokes over par for "format", which spans courses; and strokes over par
   * at your usual pace per hole, scaled to this round's length, for "pace".
   */
  average: number | null;
  /** This round against the average, in strokes. Negative is better. */
  delta: number | null;
  /** Your best before this round, on the same scale. Null for "pace". */
  best: number | null;
  /** Your most recent comparable score before this round, on the same scale. Null for "pace". */
  last: number | null;
}

export interface RoundBaselines {
  /** This round, when every hole is scored. A round with gaps is not compared. */
  result: RoundResult | null;
  /** Rounds with the same holes at this course. */
  course: RoundBaseline;
  /** Rounds of the same length anywhere. */
  format: RoundBaseline;
  /** Every finished round, nine or eighteen, by pace per hole. */
  pace: RoundBaseline;
}

function averaged(kind: RoundBaselineKind, newestFirst: number[], today: number | null): RoundBaseline {
  const recent = newestFirst.slice(0, BASELINE_WINDOW);
  const confidence = confidenceFor(recent.length);
  const average = confidence === "building" ? null : mean(recent);
  return {
    kind,
    rounds: newestFirst.length,
    samples: recent.length,
    confidence,
    average,
    delta: average === null || today === null ? null : today - average,
    best: newestFirst.length ? Math.min(...newestFirst) : null,
    last: newestFirst[0] ?? null,
  };
}

/** This round against your rounds before it, from the closest comparison to the broadest. */
export function buildRoundBaselines(
  history: GolfRound[],
  round: GolfRound,
  scores: Record<number, number> = round.scores,
): RoundBaselines {
  const result = completeResult(round, scores);
  const key = layoutKey(round);
  const past = finished(history);

  const here = past.filter((entry) => entry.key === key).map((entry) => entry.result.total);
  const sameLength = result
    ? past.filter((entry) => entry.result.holes === result.holes).map((entry) => entry.result.toPar)
    : [];

  // Pace blends nines and eighteens by strokes over par per hole: the broadest fair comparison.
  const recent = past.slice(0, BASELINE_WINDOW).map((entry) => entry.result);
  const paceConfidence = confidenceFor(recent.length);
  const holesPlayed = recent.reduce((sum, item) => sum + item.holes, 0);
  const paceAverage = result && paceConfidence !== "building"
    ? (recent.reduce((sum, item) => sum + item.toPar, 0) / holesPlayed) * result.holes
    : null;

  return {
    result,
    course: averaged("course", here, result?.total ?? null),
    format: averaged("format", sameLength, result?.toPar ?? null),
    pace: {
      kind: "pace",
      rounds: past.length,
      samples: recent.length,
      confidence: paceConfidence,
      average: paceAverage,
      delta: paceAverage === null || !result ? null : result.toPar - paceAverage,
      best: null,
      last: null,
    },
  };
}

export interface RoundRank {
  position: number;
  of: number;
  /** Another round had exactly the same score. */
  tied: boolean;
}

/**
 * Where this round sits among your rounds up to and including it: by strokes among rounds with
 * the same holes at this course, and by strokes over par among rounds of the same length. Null
 * below MIN_SAMPLES rounds, where "best of two" says little.
 */
export function rankRound(
  history: GolfRound[],
  round: GolfRound,
  scores: Record<number, number> = round.scores,
): { course: RoundRank | null; format: RoundRank | null } {
  const result = completeResult(round, scores);
  if (!result) return { course: null, format: null };
  const key = layoutKey(round);
  const past = finished(history);
  const rank = (others: number[], today: number): RoundRank | null =>
    others.length + 1 >= MIN_SAMPLES
      ? { position: 1 + others.filter((value) => value < today).length, of: others.length + 1, tied: others.includes(today) }
      : null;
  return {
    course: rank(past.filter((entry) => entry.key === key).map((entry) => entry.result.total), result.total),
    format: rank(past.filter((entry) => entry.result.holes === result.holes).map((entry) => entry.result.toPar), result.toPar),
  };
}

// Trends --------------------------------------------------------------------------------------

export interface TrendPoint {
  roundId: string;
  courseName: string;
  playedAt: string;
  total: number;
  toPar: number;
  /** The round the trend was drawn up to. */
  current: boolean;
}

export type TrendDirection = "improving" | "steady" | "worsening" | "mixed";

export interface ScoringTrend {
  holes: 9 | 18;
  /** Oldest first. */
  points: TrendPoint[];
  /** Null until TREND_MIN_ROUNDS rounds are in the window. */
  direction: TrendDirection | null;
  /** Fitted change in strokes over par across the window. Negative is better. */
  change: number | null;
  /** Rounds still needed before a direction is read. */
  needed: number;
}

/**
 * Your last few rounds of one length and which way they are heading.
 *
 * Scores are compared by strokes over par, so rounds at different courses line up fairly.
 * A direction is claimed only when a straight-line fit across the window moves by at least
 * two strokes an eighteen (one a nine) and the later half of the window agrees with it by
 * averaging better, or worse, than the earlier half. Anything smaller is "steady", and a fit
 * the halves contradict is "mixed", which claims nothing.
 */
export function scoringTrend(
  rounds: GolfRound[],
  options: { holes: 9 | 18; through?: GolfRound; limit?: number },
): ScoringTrend {
  const { holes, through, limit = 5 } = options;
  const cutoff = through ? playedAt(through) : Number.POSITIVE_INFINITY;
  const points: TrendPoint[] = finished(rounds)
    .filter((entry) => entry.result.holes === holes && (entry.round.id === through?.id || playedAt(entry.round) <= cutoff))
    .sort((left, right) => playedAt(left.round) - playedAt(right.round))
    .slice(-limit)
    .map(({ round, result }) => ({
      roundId: round.id,
      courseName: courseOf(round).shortName || round.courseName,
      playedAt: round.completedAt ?? round.startedAt,
      total: result.total,
      toPar: result.toPar,
      current: round.id === through?.id,
    }));

  const needed = Math.max(0, TREND_MIN_ROUNDS - points.length);
  if (needed) return { holes, points, direction: null, change: null, needed };

  const values = points.map((point) => point.toPar);
  const count = values.length;
  const middle = (count - 1) / 2;
  const average = mean(values);
  let covariance = 0;
  let spread = 0;
  values.forEach((value, index) => {
    covariance += (index - middle) * (value - average);
    spread += (index - middle) ** 2;
  });
  const change = (covariance / spread) * (count - 1);
  const half = Math.floor(count / 2);
  const halves = mean(values.slice(-half)) - mean(values.slice(0, half));
  const threshold = holes === 18 ? 2 : 1;

  let direction: TrendDirection;
  if (Math.abs(change) < threshold) direction = "steady";
  else if (change < 0 && halves < 0) direction = "improving";
  else if (change > 0 && halves > 0) direction = "worsening";
  else direction = "mixed";

  return { holes, points, direction, change: Math.round(change * 10) / 10, needed: 0 };
}

/** The trend in a sentence that claims no more than the numbers do. */
export function describeTrend(trend: ScoringTrend): string {
  const rounds = countWord(trend.points.length);
  const noun = formatNoun(trend.holes, trend.points.length);
  if (trend.direction === null) {
    return `Play ${countWord(trend.needed)} more ${formatNoun(trend.holes, trend.needed)} to see which way your scores are heading.`;
  }
  const strokes = Math.max(1, Math.round(Math.abs(trend.change ?? 0)));
  const amount = `${strokes} ${strokes === 1 ? "stroke" : "strokes"}`;
  switch (trend.direction) {
    case "improving":
      return `Trending better: about ${amount} lower across your last ${rounds} ${noun}.`;
    case "worsening":
      return `Scores have crept up about ${amount} across your last ${rounds} ${noun}.`;
    case "steady":
      return `Holding steady across your last ${rounds} ${noun}.`;
    default:
      return `Up and down across your last ${rounds} ${noun}, with no clear trend yet.`;
  }
}

// Progress across rounds ----------------------------------------------------------------------

export interface CourseProgress {
  key: string;
  courseName: string;
  location: string;
  segment: RoundSegment;
  holes: 9 | 18;
  par: number;
  rounds: number;
  /** Average strokes over your most recent rounds here; null below MIN_SAMPLES rounds. */
  average: number | null;
  best: number;
  last: { roundId: string; total: number; playedAt: string };
  /** Your latest round here against the average of your rounds here before it. */
  lastVsAverage: number | null;
  confidence: BaselineConfidence;
}

/** Courses you have finished at least twice with the same holes, most played first. */
export function courseProgress(rounds: GolfRound[]): CourseProgress[] {
  const groups = new Map<string, Array<{ round: GolfRound; result: RoundResult }>>();
  for (const entry of finished(rounds)) {
    groups.set(entry.key, [...(groups.get(entry.key) ?? []), entry]);
  }

  return [...groups.entries()]
    .filter(([, entries]) => entries.length >= 2)
    .map(([key, entries]) => {
      const newest = [...entries].sort((left, right) => playedAt(right.round) - playedAt(left.round));
      const totals = newest.map((entry) => entry.result.total);
      const recent = totals.slice(0, BASELINE_WINDOW);
      const before = totals.slice(1, BASELINE_WINDOW + 1);
      const latest = newest[0];
      const course = courseOf(latest.round);
      return {
        key,
        courseName: course.shortName || latest.round.courseName,
        location: course.location,
        segment: latest.round.segment,
        holes: latest.result.holes,
        par: latest.result.par,
        rounds: entries.length,
        average: recent.length >= MIN_SAMPLES ? mean(recent) : null,
        best: Math.min(...totals),
        last: { roundId: latest.round.id, total: latest.result.total, playedAt: latest.round.completedAt ?? latest.round.startedAt },
        lastVsAverage: before.length >= MIN_SAMPLES ? latest.result.total - mean(before) : null,
        confidence: confidenceFor(recent.length),
      };
    })
    .sort((left, right) => right.rounds - left.rounds || new Date(right.last.playedAt).getTime() - new Date(left.last.playedAt).getTime());
}

export interface FormatProgress {
  holes: 9 | 18;
  rounds: number;
  /** Average strokes over par across your last five rounds of this length; null below MIN_SAMPLES. */
  lastFive: number | null;
  /** The same across your last ten, only once there are more than five to average. */
  lastTen: number | null;
  best: { roundId: string; total: number; toPar: number; courseName: string; playedAt: string } | null;
  trend: ScoringTrend;
}

/** Your nines, or your eighteens, as a progression. */
export function formatProgress(rounds: GolfRound[], holes: 9 | 18): FormatProgress {
  const newest = finished(rounds)
    .filter((entry) => entry.result.holes === holes)
    .sort((left, right) => playedAt(right.round) - playedAt(left.round));
  const toPar = newest.map((entry) => entry.result.toPar);
  const bestEntry = newest.reduce<(typeof newest)[number] | null>((best, entry) => {
    if (!best) return entry;
    if (entry.result.toPar !== best.result.toPar) return entry.result.toPar < best.result.toPar ? entry : best;
    return entry.result.total < best.result.total ? entry : best;
  }, null);

  return {
    holes,
    rounds: newest.length,
    lastFive: toPar.length >= MIN_SAMPLES ? mean(toPar.slice(0, 5)) : null,
    lastTen: toPar.length > 5 ? mean(toPar.slice(0, BASELINE_WINDOW)) : null,
    best: bestEntry
      ? {
          roundId: bestEntry.round.id,
          total: bestEntry.result.total,
          toPar: bestEntry.result.toPar,
          courseName: courseOf(bestEntry.round).shortName || bestEntry.round.courseName,
          playedAt: bestEntry.round.completedAt ?? bestEntry.round.startedAt,
        }
      : null,
    trend: scoringTrend(rounds, { holes, limit: BASELINE_WINDOW }),
  };
}
