import { z } from "zod";
import { GENESEE_VALLEY_SOUTH } from "./courses";
import { courseMatchesPhrase } from "./tee-selection";
import type { Course, Hole, RoundSegment } from "./types";

/**
 * Turns a photographed paper scorecard into the shapes the app already stores.
 *
 * The model reads pixels and nothing else. Every decision about which course,
 * which nine, and which numbers actually get saved happens here, where it can
 * be tested without a model in the loop.
 */

const readingHoleSchema = z.object({
  number: z.number().int().min(1).max(18),
  par: z.number().int().min(3).max(6),
  yards: z.number().int().min(0).max(1000).optional(),
  handicap: z.number().int().min(1).max(18).optional(),
});

export const scorecardReadingSchema = z.object({
  courseName: z.string(),
  location: z.string(),
  tee: z.string(),
  /** Empty when the card is undated, otherwise YYYY-MM-DD. */
  datePlayed: z.string(),
  rating: z.number().min(25).max(85).optional(),
  slope: z.number().int().min(55).max(155).optional(),
  holes: z.array(readingHoleSchema).min(9).max(18),
  players: z
    .array(
      z.object({
        name: z.string(),
        scores: z
          .array(
            z.object({
              hole: z.number().int().min(1).max(18),
              strokes: z.number().int().min(1).max(20),
            }),
          )
          .max(18),
      }),
    )
    .min(1)
    .max(6),
  note: z.string(),
});

export type ScorecardReading = z.infer<typeof scorecardReadingSchema>;
export type ScorecardReadingHole = z.infer<typeof readingHoleSchema>;

export interface ImportedRound {
  course: Course;
  segment: RoundSegment;
  scores: Record<number, number>;
  playedAt: string;
  /** Holes on the card whose score could not be read. */
  missingHoles: number[];
  /** True when the card was matched to a scorecard the app already holds. */
  matchedKnownCourse: boolean;
}

export class ScorecardImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScorecardImportError";
  }
}

/** USGA neutral slope, used when the card does not print its own. */
const NEUTRAL_SLOPE = 113;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** "WHITE TEES" off a card becomes the "White" the rest of the app prints. */
function displayTee(value: string): string {
  const named = value.trim().replace(/\s+tees?$/i, "").trim();
  if (!named) return "Unspecified";
  return named.replace(/\S+/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
}

function sequence(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

function sortedUniqueHoles(holes: ScorecardReadingHole[]): ScorecardReadingHole[] {
  const byNumber = new Map<number, ScorecardReadingHole>();
  for (const hole of holes) if (!byNumber.has(hole.number)) byNumber.set(hole.number, hole);
  return [...byNumber.values()].sort((left, right) => left.number - right.number);
}

type HoleSpan = "front" | "back" | "full";

/** A scorecard is only importable when its holes form a real nine or eighteen. */
function detectSpan(numbers: number[]): HoleSpan {
  const matches = (expected: number[]) =>
    numbers.length === expected.length && numbers.every((value, index) => value === expected[index]);
  if (matches(sequence(1, 9))) return "front";
  if (matches(sequence(10, 18))) return "back";
  if (matches(sequence(1, 18))) return "full";
  throw new ScorecardImportError(
    "I could only read part of that card. Photograph the whole scorecard so every hole of the nine or eighteen is visible.",
  );
}

/**
 * Matches the card against scorecards the app already holds, using the same
 * fuzzy name matcher the voice flow uses so a misread letter still lands.
 */
function findKnownCourse(reading: ScorecardReading, span: HoleSpan, knownCourses: Course[]): Course | null {
  const printed = reading.courseName.trim();
  if (printed.length < 4) return null;
  return (
    [...knownCourses, GENESEE_VALLEY_SOUTH].find((course) => {
      const holesCover = span === "front" ? course.holes.length >= 9 : course.holes.length === 18;
      return holesCover && courseMatchesPhrase(course, printed);
    }) ?? null
  );
}

/**
 * Builds a course from the card itself. Hole numbers restart at one because a
 * standalone nine is stored as its own course, and the rest of the app reads a
 * segment by position within `holes`.
 */
function synthesizeCourse(reading: ScorecardReading, span: HoleSpan, holes: ScorecardReadingHole[]): Course {
  // Printed stroke indexes are only kept when the whole card carries them; a
  // partial read would otherwise leave duplicate indexes behind.
  const printedHandicaps = holes.every((hole) => hole.handicap != null);
  const courseHoles: Hole[] = holes.map((hole, index) => ({
    number: index + 1,
    par: hole.par,
    yards: Math.min(1000, Math.max(0, hole.yards ?? 0)),
    handicap: printedHandicaps ? (hole.handicap as number) : index + 1,
    suggestedClub: "—",
    strategy: "Imported from a scorecard photo; no course guidance available.",
  }));

  const baseName = reading.courseName.trim() || "Scanned scorecard";
  const name = span === "back" ? `${baseName} — Back 9` : baseName;
  const tee = displayTee(reading.tee);
  const par = courseHoles.reduce((total, hole) => total + hole.par, 0);

  return {
    id: `photo-${slugify(name) || "scorecard"}-${slugify(tee) || "tee"}`,
    name,
    shortName: name,
    location: reading.location.trim(),
    tee,
    // A card without a printed rating still has to produce a usable handicap
    // differential, so par and the neutral slope stand in for the real pair.
    rating: reading.rating ?? par,
    slope: reading.slope ?? NEUTRAL_SLOPE,
    par,
    yards: courseHoles.reduce((total, hole) => total + hole.yards, 0),
    sourceUrl: "",
    holes: courseHoles,
  };
}

/** Pro shops print the date however they like, so both common styles are read. */
function parseCardDate(value: string): { year: number; month: number; day: number } | null {
  const text = value.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };

  const written = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(text);
  if (!written) return null;
  const first = Number(written[1]);
  const second = Number(written[2]);
  // Month leads, the way a US card reads, unless that ordering is impossible.
  const [month, day] = first > 12 ? [second, first] : [first, second];
  const year = Number(written[3]);
  return { year: year < 100 ? 2000 + year : year, month, day };
}

function resolvePlayedAt(datePlayed: string, now: Date): string {
  const card = parseCardDate(datePlayed);
  if (!card) return now.toISOString();
  // Midday keeps the round on the date printed on the card in every time zone.
  const parsed = new Date(card.year, card.month - 1, card.day, 12);
  // A rolled-over date such as February 31 means the read was wrong.
  if (parsed.getMonth() !== card.month - 1 || parsed.getDate() !== card.day) return now.toISOString();
  // A misread year must not file the round in the future.
  return parsed.getTime() > now.getTime() ? now.toISOString() : parsed.toISOString();
}

export interface BuildImportedRoundOptions {
  /** Which column of the card belongs to the golfer. */
  playerIndex?: number;
  knownCourses?: Course[];
  now?: Date;
}

/** Converts one reading into a completed round, ready to save. */
export function buildImportedRound(
  reading: ScorecardReading,
  { playerIndex = 0, knownCourses = [], now = new Date() }: BuildImportedRoundOptions = {},
): ImportedRound {
  const holes = sortedUniqueHoles(reading.holes);
  const span = detectSpan(holes.map((hole) => hole.number));

  const player = reading.players[playerIndex];
  if (!player) throw new ScorecardImportError("That column of the card is missing its scores.");

  const known = findKnownCourse(reading, span, knownCourses);
  const course = known ?? synthesizeCourse(reading, span, holes);
  const matchedKnownCourse = known != null;

  // A saved course keeps the card's own hole numbers; a synthesized one
  // restarts at hole 1, so a standalone back nine has to be shifted onto it.
  const segment: RoundSegment = matchedKnownCourse
    ? span === "front"
      ? "front9"
      : span === "back"
        ? "back9"
        : "full18"
    : span === "full"
      ? "full18"
      : "front9";
  const holeOffset = matchedKnownCourse || span !== "back" ? 0 : 9;

  const scores: Record<number, number> = {};
  for (const score of player.scores) {
    if (holes.some((hole) => hole.number === score.hole)) scores[score.hole - holeOffset] = score.strokes;
  }
  if (Object.keys(scores).length === 0) {
    throw new ScorecardImportError("I couldn’t read any scores on that card. Try a straighter, brighter photo.");
  }

  const missingHoles = holes
    .map((hole) => hole.number - holeOffset)
    .filter((number) => scores[number] == null);

  return {
    course,
    segment,
    scores,
    playedAt: resolvePlayedAt(reading.datePlayed, now),
    missingHoles,
    matchedKnownCourse,
  };
}
