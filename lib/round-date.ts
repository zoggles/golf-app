import type { GolfRound } from "./types";

/**
 * Moving a round to a different day.
 *
 * A round carries two timestamps, and the app files it under the later one. So
 * correcting the date shifts both by the same whole number of days rather than
 * stamping a new date onto each: the time of day survives, and so does a round
 * that ran past midnight.
 *
 * Everything here works in the golfer's local time, which is the date the app
 * shows them and the date they mean when they change it.
 */

export interface ShiftedRoundDates {
  startedAt: string;
  completedAt?: string;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** The `YYYY-MM-DD` an `<input type="date">` expects, in local time. */
export function dateInputValue(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Reads an input value back as local midnight, rejecting a date that isn't one. */
export function parseDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const parsed = new Date(year, month - 1, day);
  // February 31 rolls over into March rather than failing, so check it back.
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null;
  return parsed;
}

/** The day a round is filed under: when it finished, or when it started. */
export function roundDateInputValue(round: GolfRound): string {
  return dateInputValue(new Date(round.completedAt ?? round.startedAt));
}

/** New timestamps putting the round on `value`, or null if that changes nothing. */
export function shiftRoundToDate(round: GolfRound, value: string): ShiftedRoundDates | null {
  const target = parseDateInput(value);
  if (!target) return null;

  const filedUnder = new Date(round.completedAt ?? round.startedAt);
  if (Number.isNaN(filedUnder.getTime())) return null;

  // Measuring between two local midnights keeps the clock time intact across a
  // daylight saving change, where a day is not always 24 hours long.
  const offsetMs = target.getTime() - startOfLocalDay(filedUnder).getTime();
  if (offsetMs === 0) return null;

  const shift = (iso: string) => new Date(new Date(iso).getTime() + offsetMs).toISOString();
  return {
    startedAt: shift(round.startedAt),
    ...(round.completedAt ? { completedAt: shift(round.completedAt) } : {}),
  };
}
