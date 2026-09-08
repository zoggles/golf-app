import { getSegmentHoles, segmentLabel } from "./courses";
import { estimateHandicap, estimateRoundHandicap, handicapStrokesForHole } from "./metrics";
import { dateInputValue } from "./round-date";
import type { GolfRound } from "./types";

/**
 * Builds the downloadable history file.
 *
 * The stored data is a round, a course scorecard, and a score per hole, so the
 * export is one row per hole with the round's details repeated on each row.
 * That is the shape spreadsheets sort, filter, and pivot without any reshaping,
 * and it keeps every number the app holds about a shot-by-shot history: par,
 * yardage, stroke index, and the gross and net score against them.
 *
 * Handicap columns use the index estimated from the whole history, the same one
 * the progress page shows, so a re-export after more rounds restates them.
 */

const COLUMNS = [
  "golfer",
  "played_on",
  "played_at",
  "status",
  "course",
  "location",
  "tee",
  "segment",
  "course_rating",
  "course_slope",
  "hole",
  "par",
  "yards",
  "stroke_index",
  "strokes",
  "hole_to_par",
  "hole_handicap_strokes",
  "net_strokes",
  "round_strokes",
  "round_par",
  "round_to_par",
  "round_handicap",
  "holes_played",
  "round_id",
] as const;

function escapeCell(value: string | number | null): string {
  if (value == null || value === "") return "";
  const text = String(value);
  // A leading =, +, or @ makes a spreadsheet treat course names and notes as
  // formulas, so those cells are pushed back into plain text.
  const safe = /^[=+@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function playedAt(round: GolfRound): string {
  return round.completedAt ?? round.startedAt;
}

/**
 * The local calendar day, which is the date the app shows and the one the
 * golfer sets. Reading it off the stored UTC timestamp instead would file an
 * evening round under the following day.
 */
function playedOn(round: GolfRound): string {
  return dateInputValue(new Date(playedAt(round)));
}

/** Every round the app holds for one golfer, oldest first, one row per hole. */
export function buildHistoryCsv(rounds: GolfRound[], golferName: string): string {
  // Two rounds on the same day keep the order they were played in.
  const ordered = [...rounds].sort(
    (left, right) => new Date(playedAt(left)).getTime() - new Date(playedAt(right)).getTime(),
  );
  const handicapIndex = estimateHandicap(rounds);
  const rows: string[] = [COLUMNS.join(",")];

  for (const round of ordered) {
    const holes = getSegmentHoles(round.course, round.segment);
    const scored = holes.filter((hole) => round.scores[hole.number] != null);
    const roundStrokes = scored.reduce((total, hole) => total + round.scores[hole.number], 0);
    const roundPar = scored.reduce((total, hole) => total + hole.par, 0);
    const roundHandicap = estimateRoundHandicap(handicapIndex, round.course, round.segment);

    for (const hole of holes) {
      const strokes = round.scores[hole.number] ?? null;
      // Without an index there are no strokes to give, which is not the same
      // as giving none, so those cells stay empty rather than reading zero.
      const given = roundHandicap == null ? null : handicapStrokesForHole(roundHandicap, hole, holes);
      rows.push(
        [
          golferName,
          playedOn(round),
          playedAt(round),
          round.status,
          round.courseName,
          round.location,
          round.tee,
          segmentLabel(round.segment),
          round.courseRating,
          round.courseSlope,
          hole.number,
          hole.par,
          hole.yards,
          hole.handicap,
          strokes,
          strokes == null ? null : strokes - hole.par,
          given,
          strokes == null || given == null ? null : strokes - given,
          roundStrokes,
          roundPar,
          roundStrokes - roundPar,
          roundHandicap,
          scored.length,
          round.id,
        ]
          .map(escapeCell)
          .join(","),
      );
    }
  }

  // CRLF is what spreadsheet apps expect from a .csv.
  return `${rows.join("\r\n")}\r\n`;
}

export function historyExportFilename(golferName: string, now: Date): string {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const golfer = golferName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // Two golfers exporting on the same day should not produce the same file.
  return `fairway-log-${golfer || "golfer"}-history-${date}.csv`;
}
