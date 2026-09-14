import { getCourse, getSegmentHoles } from "./courses";
import type { GolfRound, RoundSegment } from "./types";

/**
 * Telling nine- and eighteen-hole rounds apart, and comparing them fairly.
 *
 * A nine and an eighteen sit on different scales — a 54 next to a 112 is not a good day next
 * to a bad one — so wherever rounds appear side by side the format is named beside the score,
 * and anything that ranks or charts them compares pace per hole rather than raw totals.
 */

export type RoundFormat = "nine" | "eighteen";

export function roundFormat(holesPlayed: number): RoundFormat | null {
  if (holesPlayed === 18) return "eighteen";
  if (holesPlayed === 9) return "nine";
  return null;
}

/** Which halves of an eighteen a round covers, for the two-part format mark. */
export function litHalves(segment: RoundSegment, holesPlayed: number): { front: boolean; back: boolean } {
  if (holesPlayed >= 18) return { front: true, back: true };
  if (segment === "back9") return { front: false, back: true };
  return { front: true, back: false };
}

export function formatLabel(segment: RoundSegment, holesPlayed: number): string {
  if (holesPlayed >= 18) return "18 holes";
  if (holesPlayed === 9 && segment === "back9") return "Back 9";
  if (holesPlayed === 9 && segment === "front9") return "Front 9";
  return `${holesPlayed} ${holesPlayed === 1 ? "hole" : "holes"}`;
}

/** For tight spaces such as a chart column, where the mark itself shows front or back. */
export function shortFormatLabel(holesPlayed: number): string {
  return holesPlayed >= 18 ? "18" : String(holesPlayed);
}

/** Strokes over par per hole: the one number that compares a nine with an eighteen. */
export function pacePerHole(toPar: number, holesPlayed: number): number {
  return holesPlayed > 0 ? toPar / holesPlayed : 0;
}

/**
 * Bar heights for a set of paces, scaled to those paces.
 *
 * Measured up from even par, or from the best pace when one went under, so equal pace means
 * equal height and the tallest bar is the worst pace on screen. This replaces a fixed
 * multiplier that capped at +12, which drew every bar at full height for anyone who usually
 * plays above that.
 */
export function paceHeights(paces: number[], minHeight = 14, maxHeight = 100): number[] {
  if (paces.length === 0) return [];
  const top = Math.max(0, ...paces);
  const bottom = Math.min(0, ...paces);
  const span = top - bottom;
  if (span === 0) return paces.map(() => minHeight);
  return paces.map((pace) => Math.round(minHeight + ((pace - bottom) / span) * (maxHeight - minHeight)));
}

export interface NineResult {
  /** Strokes against par over the holes of this nine that were scored. */
  toPar: number;
  holes: number;
  pace: number;
}

export interface RoundNines {
  front: NineResult | null;
  back: NineResult | null;
}

/**
 * Each nine of a round on its own, so a front can be compared with a back.
 *
 * Halves are taken by position within the round rather than by hole number, so a scorecard
 * that numbers its holes differently still splits into its first and second nine. A nine-hole
 * round fills only the half it covers.
 */
export function roundNines(round: GolfRound): RoundNines {
  const holes = getSegmentHoles(round.course ?? getCourse(round.courseId), round.segment);
  const nine = (slice: typeof holes): NineResult | null => {
    const scored = slice.filter((hole) => round.scores[hole.number] != null);
    if (scored.length === 0) return null;
    const toPar = scored.reduce((sum, hole) => sum + round.scores[hole.number] - hole.par, 0);
    return { toPar, holes: scored.length, pace: toPar / scored.length };
  };

  if (holes.length >= 18) return { front: nine(holes.slice(0, 9)), back: nine(holes.slice(9)) };
  const halves = litHalves(round.segment, holes.length);
  return halves.back && !halves.front ? { front: null, back: nine(holes) } : { front: nine(holes), back: null };
}

/**
 * Heights for both halves of every bar, on one scale shared by every nine on screen.
 *
 * Each half of an eighteen is a nine in its own right, so a front nine, a back nine and a
 * nine-hole round are all measured the same way, and a worse back nine stands visibly taller
 * than its front. A half that was not played takes the height of the half that was, so it
 * still outlines as the missing half of the round.
 */
export function nineBarHeights(rounds: RoundNines[], minHeight = 14, maxHeight = 100): Array<{ front: number; back: number }> {
  const paces = rounds.flatMap((round) => [round.front, round.back].flatMap((nine) => (nine ? [nine.pace] : [])));
  const heights = paceHeights(paces, minHeight, maxHeight);
  let next = 0;
  return rounds.map((round) => {
    let front: number | null = null;
    let back: number | null = null;
    if (round.front) {
      front = heights[next];
      next += 1;
    }
    if (round.back) {
      back = heights[next];
      next += 1;
    }
    return { front: front ?? back ?? minHeight, back: back ?? front ?? minHeight };
  });
}

interface Rankable {
  toPar: number;
  total: number;
  holesPlayed: number;
  date: string;
}

function beats(candidate: Rankable, current: Rankable): boolean {
  if (candidate.toPar !== current.toPar) return candidate.toPar < current.toPar;
  if (candidate.total !== current.total) return candidate.total < current.total;
  return new Date(candidate.date).getTime() > new Date(current.date).getTime();
}

/**
 * The best nine and the best eighteen, each judged only against its own kind.
 *
 * One shared "best round" ranked by to-par is won by a nine almost every time, because a
 * nine has half the holes to go over par on.
 */
export function bestByFormat<T extends Rankable>(rounds: T[]): Record<RoundFormat, T | null> {
  const best: Record<RoundFormat, T | null> = { nine: null, eighteen: null };
  for (const round of rounds) {
    const format = roundFormat(round.holesPlayed);
    if (!format) continue;
    const current = best[format];
    if (!current || beats(round, current)) best[format] = round;
  }
  return best;
}

/** "3 nines · 1 eighteen", or null when there is neither. */
export function describeFormatCounts(rounds: Array<{ holesPlayed: number }>): string | null {
  let nines = 0;
  let eighteens = 0;
  for (const round of rounds) {
    const format = roundFormat(round.holesPlayed);
    if (format === "nine") nines += 1;
    else if (format === "eighteen") eighteens += 1;
  }
  const parts: string[] = [];
  if (nines) parts.push(`${nines} ${nines === 1 ? "nine" : "nines"}`);
  if (eighteens) parts.push(`${eighteens} ${eighteens === 1 ? "eighteen" : "eighteens"}`);
  return parts.length ? parts.join(" · ") : null;
}
