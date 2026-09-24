import type { HoleObstacle } from "@/lib/hole-obstacles";

/**
 * Mapped obstacles ahead on this hole, as rangefinder numbers: yards to the nearest edge and
 * yards to the far edge. Rounded the safe way, the near edge down and the far edge up.
 *
 * Renders nothing when nothing is mapped ahead, rather than a reassuring "all clear": what
 * OpenStreetMap does not show may still be there.
 */

const KIND_LABEL: Record<HoleObstacle["kind"], string> = {
  water: "Water",
  bunker: "Bunker",
  trees: "Trees",
  out_of_bounds: "Out of bounds",
};

export function obstacleLabel(row: HoleObstacle): string {
  const kind = KIND_LABEL[row.kind];
  if (row.side === "across") return `${kind} across`;
  if (row.side === "long") return `${kind} behind the green`;
  return row.byGreen ? `${kind} ${row.side} of the green` : `${kind} ${row.side}`;
}

export function ObstacleList({ rows }: { rows: HoleObstacle[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="caddy-obstacles" aria-label="Mapped hazards ahead">
      <div className="caddy-obstacles-head">
        <small>MAPPED HAZARDS</small>
        <small>REACH – CARRY</small>
      </div>
      <ul>
        {rows.map((row) => (
          <li key={row.key}>
            <span className={`caddy-obstacle-mark ${row.kind}`} aria-hidden="true" />
            <span className="caddy-obstacle-name">{obstacleLabel(row)}</span>
            <strong>
              {Math.floor(row.reachYds)}–{Math.ceil(row.carryYds)}
            </strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
