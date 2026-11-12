import { estimateHandicap } from "./metrics";
import type { GolfRound } from "./types";

/**
 * Seasons: the calendar year a round is filed under.
 *
 * Progress shows one season at a time, so each new year starts a fresh set of averages,
 * bests, trends and round log while earlier seasons stay a tap away. A round belongs to the
 * local year of the day it is filed under (when it finished, or when it started), the same
 * day the app shows and the golfer can correct, so moving a round's date moves its season.
 *
 * The handicap is the exception. It carries from one season into the next, as an official
 * index does, so the first round of a new year still gets its strokes on every hole.
 */

export const ALL_SEASONS = "all";

/** A single season by year, or every round the golfer has. */
export type SeasonView = number | typeof ALL_SEASONS;

export function seasonOf(round: GolfRound): number {
  return new Date(round.completedAt ?? round.startedAt).getFullYear();
}

/** Every season with a round in it, newest first, always including the one under way. */
export function seasonsFor(rounds: GolfRound[], currentSeason: number): number[] {
  const seasons = new Set(rounds.map(seasonOf).filter(Number.isFinite));
  seasons.add(currentSeason);
  return [...seasons].sort((left, right) => right - left);
}

/**
 * The season to show: the one picked earlier, while it still exists for this golfer,
 * otherwise the one under way.
 */
export function pickSeason(saved: string | null, seasons: number[], currentSeason: number): SeasonView {
  if (saved === ALL_SEASONS) return ALL_SEASONS;
  const year = Number(saved);
  return saved && seasons.includes(year) ? year : currentSeason;
}

export function roundsInSeason(rounds: GolfRound[], season: SeasonView): GolfRound[] {
  return season === ALL_SEASONS ? rounds : rounds.filter((round) => seasonOf(round) === season);
}

export interface SeasonHandicap {
  /** The index carried in from earlier seasons; null in a golfer's first season. */
  start: number | null;
  /** The index as the season ended, or as it stands today for the season under way. */
  end: number | null;
}

export function seasonHandicap(rounds: GolfRound[], season: SeasonView): SeasonHandicap {
  if (season === ALL_SEASONS) return { start: null, end: estimateHandicap(rounds) };
  return {
    start: estimateHandicap(rounds.filter((round) => seasonOf(round) < season)),
    end: estimateHandicap(rounds.filter((round) => seasonOf(round) <= season)),
  };
}

/** "Started 2026 at 16.1 · down 1.4", or null when there was nothing to start from. */
export function describeSeasonHandicap(handicap: SeasonHandicap, season: number): { text: string; tone: "under" | "over" | "even" } | null {
  if (handicap.start == null || handicap.end == null) return null;
  const change = Math.round((handicap.end - handicap.start) * 10) / 10;
  const started = `Started ${season} at ${handicap.start.toFixed(1)}`;
  if (change === 0) return { text: `${started} · no change`, tone: "even" };
  // A lower index is a better golfer.
  return { text: `${started} · ${change < 0 ? "down" : "up"} ${Math.abs(change).toFixed(1)}`, tone: change < 0 ? "under" : "over" };
}
