import { formatLabel, litHalves, shortFormatLabel } from "@/lib/round-format";
import type { RoundSegment } from "@/lib/types";

/**
 * Nine or eighteen, read at the same glance as the score.
 *
 * Two halves of an eighteen: a front nine lights the left, a back nine the right, a full
 * round both. The shape carries the format so it registers before any text is read.
 */
export function FormatMark({
  segment,
  holesPlayed,
  label = "full",
}: {
  segment: RoundSegment;
  holesPlayed: number;
  /** "full" names the nine, "short" gives just 9 or 18, "none" shows the mark alone. */
  label?: "full" | "short" | "none";
}) {
  const halves = litHalves(segment, holesPlayed);
  const name = formatLabel(segment, holesPlayed);
  const pill = (
    <span className="format-pill" aria-hidden="true">
      <span className={halves.front ? "on" : undefined} />
      <span className={halves.back ? "on" : undefined} />
    </span>
  );

  if (label === "none") {
    return (
      <span className="format-mark" role="img" aria-label={name}>
        {pill}
      </span>
    );
  }

  return (
    <span className="format-mark" title={name}>
      {pill}
      <span>{label === "short" ? shortFormatLabel(holesPlayed) : name}</span>
    </span>
  );
}
