import {
  bearingDeg,
  destination,
  haversineM,
  localProjection,
  metresToYards,
  nearestPointOnPath,
  pathLengthM,
  pointAlongPath,
  pointInPolygon,
  yardsToMetres,
} from "./geo";
import type { CourseHazard, LatLng, PlayingHoleGeometry, TreeArea } from "./hole-geometry";

/**
 * What stands between the player and the green on this hole, with rangefinder numbers.
 *
 * Every number here is a straight-line distance from where the player is standing to a
 * mapped edge, the same measurement as front, middle and back. Nothing is inferred about
 * features that are not mapped: an empty list means nothing mapped, never nothing there.
 */

export type ObstacleKind = "water" | "bunker" | "trees" | "out_of_bounds";
/** Looking toward the green. `long` is past the green, where a shot that runs through ends up. */
export type ObstacleSide = "left" | "right" | "across" | "long";

export interface HoleObstacle {
  key: string;
  kind: ObstacleKind;
  side: ObstacleSide;
  /** Starts up by the green rather than out in the fairway. */
  byGreen: boolean;
  /** To the nearest mapped edge in play. */
  reachYds: number;
  /** To the furthest mapped edge in play. */
  carryYds: number;
}

/** How far either side of the line of play an obstacle has to be to count. About a wide miss. */
export const OBSTACLE_CORRIDOR_YDS = 30;
/** Behind the green, a bunker or pond still catches a shot that runs through. */
const BEYOND_GREEN_M = 15;
/** Anything beside the player rather than ahead of them is not part of the next shot. */
const AHEAD_OF_PLAYER_M = 5;
/** Spacing of the points walked around an outline and along the line of play. */
const SAMPLE_STEP_M = 3;
/** Past this gap along the hole, two pieces of one outline are two obstacles. */
const STRETCH_GAP_M = 14;
/** Trees along less of the hole than this are a stray clump, not something to play around. */
const MIN_TREE_STRETCH_M = 9;
/** A stretch that starts within this of the front of the green is greenside. */
const GREENSIDE_M = 20;
/** A row that ends this close is underfoot, not ahead. */
const MIN_CARRY_YDS = 15;
/** Two tree areas on the same side this close together read as one line of trees. */
const TREE_MERGE_GAP_YDS = 15;

function kindOf(hazard: CourseHazard): ObstacleKind {
  if (hazard.kind === "lateral_water") return "water";
  return hazard.kind;
}

/** Points along a closed outline, no further apart than the sample step. */
function walkOutline(outline: LatLng[]): LatLng[] {
  const ring = [...outline, outline[0]];
  const points: LatLng[] = [];
  for (let index = 0; index < ring.length - 1; index += 1) {
    const start = ring[index];
    const end = ring[index + 1];
    const lengthM = haversineM(start, end);
    const steps = Math.max(1, Math.ceil(lengthM / SAMPLE_STEP_M));
    const bearing = bearingDeg(start, end);
    for (let step = 0; step < steps; step += 1) points.push(destination(start, bearing, (lengthM * step) / steps));
  }
  return points;
}

/** An outline for a hazard saved as a circle, from before bunkers kept their shape. */
function circleOutline(centre: LatLng, radiusM: number): LatLng[] {
  return Array.from({ length: 16 }, (_unused, index) => destination(centre, (index * 360) / 16, radiusM));
}

function outlineOf(hazard: CourseHazard): LatLng[] {
  return hazard.outline.length >= 3 ? hazard.outline : circleOutline(hazard.centre, hazard.radiusM);
}

interface LineOfPlay {
  path: LatLng[];
  startM: number;
  endM: number;
  greenFrontM: number;
  greenCentreM: number;
  /** Signed lateral side of a point: negative is left looking toward the green. */
  sideOf(point: LatLng, alongM: number): number;
}

function lineOfPlay(from: LatLng, hole: PlayingHoleGeometry): LineOfPlay {
  const last = hole.centreline[hole.centreline.length - 1];
  const beforeLast = hole.centreline[Math.max(0, hole.centreline.length - 2)];
  const finalBearing =
    haversineM(beforeLast, last) > 1 ? bearingDeg(beforeLast, last) : bearingDeg(hole.tee, hole.greenCentre);
  const pastGreenM = Math.max(haversineM(last, hole.greenBack), 0) + BEYOND_GREEN_M;
  const path = [...hole.centreline, destination(last, finalBearing, pastGreenM)];
  const projection = localProjection(from);

  return {
    path,
    startM: nearestPointOnPath(path, from).alongM + AHEAD_OF_PLAYER_M,
    endM: pathLengthM(path),
    greenFrontM: nearestPointOnPath(path, hole.greenFront).alongM,
    greenCentreM: nearestPointOnPath(path, hole.greenCentre).alongM,
    sideOf(point, alongM) {
      const behind = projection.toXY(pointAlongPath(path, Math.max(0, alongM - 2)));
      const ahead = projection.toXY(pointAlongPath(path, alongM + 2));
      const here = projection.toXY(pointAlongPath(path, alongM));
      const target = projection.toXY(point);
      // The cross product of the direction of play with the offset is negative for a point on
      // the right-hand side walking toward the green, so it is flipped to read right-positive.
      const cross = (ahead.x - behind.x) * (target.y - here.y) - (ahead.y - behind.y) * (target.x - here.x);
      return -cross;
    },
  };
}

interface EdgeSample {
  alongM: number;
  side: "left" | "right";
  distanceM: number;
}

/**
 * One outline as the stretches of the hole it lines or crosses.
 *
 * A single wood can run down the right for two hundred yards and wrap round behind the green.
 * Called one thing, that reads as trees across the whole hole, which is not what anyone sees
 * standing on the tee. Split along the hole, it is a line of trees on the right and trees
 * behind the green.
 */
function measure(from: LatLng, line: LineOfPlay, key: string, kind: ObstacleKind, outline: LatLng[]): HoleObstacle[] {
  if (pointInPolygon(from, outline)) return [];
  const corridorM = yardsToMetres(OBSTACLE_CORRIDOR_YDS);

  const samples: EdgeSample[] = [];
  for (const point of walkOutline(outline)) {
    const nearest = nearestPointOnPath(line.path, point);
    if (nearest.alongM < line.startM || nearest.alongM > line.endM || nearest.distanceM > corridorM) continue;
    samples.push({
      alongM: nearest.alongM,
      side: line.sideOf(point, nearest.alongM) < 0 ? "left" : "right",
      distanceM: haversineM(from, point),
    });
  }

  // Where the line of play itself runs through the outline. Only that makes it cross: edges
  // on both sides alone could be a pond curling round the fairway.
  const runs: Array<{ startM: number; endM: number }> = [];
  for (let alongM = line.startM; alongM <= line.endM; alongM += SAMPLE_STEP_M) {
    if (!pointInPolygon(pointAlongPath(line.path, alongM), outline)) continue;
    const current = runs[runs.length - 1];
    if (current && alongM - current.endM <= SAMPLE_STEP_M + 0.01) current.endM = alongM;
    else runs.push({ startM: alongM, endM: alongM });
  }

  const rows: HoleObstacle[] = [];
  const stretch = (side: ObstacleSide, startM: number, endM: number, distancesM: number[]) => {
    const carryYds = metresToYards(Math.max(...distancesM));
    if (carryYds < MIN_CARRY_YDS) return;
    const alongside = side === "left" || side === "right";
    if (kind === "trees" && alongside && endM - startM < MIN_TREE_STRETCH_M) return;
    rows.push({
      key: `${key}#${rows.length}`,
      kind,
      side,
      byGreen: startM >= line.greenFrontM - GREENSIDE_M,
      reachYds: metresToYards(Math.min(...distancesM)),
      carryYds,
    });
  };

  const claimed = new Set<EdgeSample>();
  for (const run of runs) {
    const shores = samples.filter(
      (sample) => sample.alongM >= run.startM - STRETCH_GAP_M && sample.alongM <= run.endM + STRETCH_GAP_M,
    );
    shores.forEach((sample) => claimed.add(sample));
    const ends = [run.startM, run.endM].map((alongM) => haversineM(from, pointAlongPath(line.path, alongM)));
    stretch(run.startM >= line.greenCentreM ? "long" : "across", run.startM, run.endM, [
      ...ends,
      ...shores.map((sample) => sample.distanceM),
    ]);
  }

  for (const side of ["left", "right"] as const) {
    const edge = samples
      .filter((sample) => sample.side === side && !claimed.has(sample))
      .sort((a, b) => a.alongM - b.alongM);
    // One pond down one side is one pond, even where it bends out of the corridor and back.
    // A wood is split at its gaps, because a gap in the trees is a real way out.
    const gapM = kind === "trees" ? STRETCH_GAP_M : Infinity;
    let group: EdgeSample[] = [];
    const flush = () => {
      if (group.length > 0) {
        stretch(side, group[0].alongM, group[group.length - 1].alongM, group.map((sample) => sample.distanceM));
      }
      group = [];
    };
    for (const sample of edge) {
      const previous = group[group.length - 1];
      if (previous && sample.alongM - previous.alongM > gapM) flush();
      group.push(sample);
    }
    flush();
  }

  return rows;
}

/** Tree areas drawn as several pieces along one side are one line of trees to a golfer. */
function mergeTreeLines(rows: HoleObstacle[]): HoleObstacle[] {
  const trees = rows.filter((row) => row.kind === "trees").sort((a, b) => a.reachYds - b.reachYds);
  const merged: HoleObstacle[] = [];
  for (const row of trees) {
    const previous = merged.find(
      (item) => item.side === row.side && row.reachYds <= item.carryYds + TREE_MERGE_GAP_YDS,
    );
    if (previous) {
      previous.carryYds = Math.max(previous.carryYds, row.carryYds);
      // A line that starts out in the fairway is not greenside because it reaches the green.
      previous.byGreen = previous.byGreen && row.byGreen;
      previous.key = `${previous.key}+${row.key}`;
    } else {
      merged.push({ ...row });
    }
  }
  return [...rows.filter((row) => row.kind !== "trees"), ...merged];
}

export interface ObstaclesAheadInput {
  from: LatLng;
  hole: PlayingHoleGeometry;
  hazards: CourseHazard[];
  trees: TreeArea[];
}

/** Mapped obstacles between the player and just past the green, nearest first. */
export function obstaclesAhead({ from, hole, hazards, trees }: ObstaclesAheadInput): HoleObstacle[] {
  const line = lineOfPlay(from, hole);
  const rows: HoleObstacle[] = [];

  for (const hazard of hazards) rows.push(...measure(from, line, hazard.osmId, kindOf(hazard), outlineOf(hazard)));
  for (const area of trees) {
    if (area.outline.length >= 3) rows.push(...measure(from, line, area.osmId, "trees", area.outline));
  }

  return mergeTreeLines(rows).sort((a, b) => a.reachYds - b.reachYds);
}

/** Rows the readout has room for. */
export const MAX_OBSTACLE_ROWS = 4;
/** Trees this far either side of where the ball comes down still frame the shot. */
const LANDING_SLACK_YDS = 10;

export interface ShotWindow {
  targetYds: number;
  longYds: number;
  rollYds: number;
}

/**
 * The rows worth reading before this shot.
 *
 * Water, bunkers and boundaries are few and each one costs a shot, so all of them ahead are
 * kept. Trees line most holes, so only the trees flanking where this shot comes down are kept,
 * one row a side. Water stays in the list ahead of trees when there is not room for both.
 */
export function obstaclesForShot(rows: HoleObstacle[], shot: ShotWindow): HoleObstacle[] {
  const nearYds = shot.targetYds - shot.longYds - LANDING_SLACK_YDS;
  const farYds = shot.targetYds + shot.longYds + shot.rollYds + LANDING_SLACK_YDS;

  const hazards = rows.filter((row) => row.kind !== "trees");
  const trees: HoleObstacle[] = [];
  for (const row of rows) {
    if (row.kind !== "trees") continue;
    if (row.carryYds < nearYds || row.reachYds > farYds) continue;
    if (trees.some((item) => item.side === row.side)) continue;
    trees.push(row);
  }

  const priority = (row: HoleObstacle) => (row.kind === "water" ? 0 : row.kind === "trees" ? 2 : 1);
  return [...hazards, ...trees]
    .sort((a, b) => priority(a) - priority(b) || a.reachYds - b.reachYds)
    .slice(0, MAX_OBSTACLE_ROWS)
    .sort((a, b) => a.reachYds - b.reachYds);
}

const LINE_STEP_M = 2;
const EDGE_PRECISION_M = 0.1;

/** Narrows a change from dry to wet (or back) between two distances down to a hand's width. */
function refineEdge(inside: (distanceM: number) => boolean, dryM: number, wetM: number): number {
  let dry = dryM;
  let wet = wetM;
  while (Math.abs(wet - dry) > EDGE_PRECISION_M) {
    const middle = (dry + wet) / 2;
    if (inside(middle)) wet = middle;
    else dry = middle;
  }
  return wet;
}

/** The first and last point of a straight line from the player that is over this water. */
function crossingOnLine(
  from: LatLng,
  bearing: number,
  outline: LatLng[],
  reachM: number,
): { nearM: number; farM: number } | null {
  const inside = (distanceM: number) => pointInPolygon(destination(from, bearing, distanceM), outline);
  let nearM = Infinity;
  let farM = -Infinity;
  for (let stepM = 0; stepM <= reachM; stepM += LINE_STEP_M) {
    if (!inside(stepM)) continue;
    if (!Number.isFinite(nearM)) nearM = stepM === 0 ? 0 : refineEdge(inside, stepM - LINE_STEP_M, stepM);
    farM = inside(stepM + LINE_STEP_M) ? stepM : refineEdge(inside, stepM + LINE_STEP_M, stepM);
  }
  return Number.isFinite(nearM) ? { nearM, farM } : null;
}

export interface WaterAdviceInput {
  from: LatLng;
  target: LatLng;
  targetYds: number;
  rollYds: number;
  dispersion: { lateralYds: number; longYds: number };
  hazards: CourseHazard[];
}

/**
 * One line about water, only when water is actually in play for the planned shot.
 *
 * Water only, because it costs a stroke and it is the most reliably mapped thing on a course.
 * Trees get no advice: steering away from mapped trees could steer into trees nobody drew.
 */
export function waterAdvice({ from, target, targetYds, rollYds, dispersion, hazards }: WaterAdviceInput): string | null {
  const shotM = haversineM(from, target);
  if (shotM < 1) return null;
  const bearing = bearingDeg(from, target);
  const projection = localProjection(from);
  const radians = (bearing * Math.PI) / 180;
  // Unit vectors along the shot and to its right.
  const along = { x: Math.sin(radians), y: Math.cos(radians) };
  const rightward = { x: Math.cos(radians), y: -Math.sin(radians) };

  const landingNearYds = targetYds - dispersion.longYds;
  const landingFarYds = targetYds + dispersion.longYds + rollYds;
  const reachM = yardsToMetres(landingFarYds);

  const water = hazards
    .filter((hazard) => hazard.kind === "water" || hazard.kind === "lateral_water")
    .map(outlineOf);

  // Where the shot line itself runs over water, walked out past the landing area.
  let crossing: { nearM: number; farM: number } | null = null;
  for (const outline of water) {
    const found = crossingOnLine(from, bearing, outline, reachM);
    if (found && (!crossing || found.nearM < crossing.nearM)) crossing = found;
  }
  if (crossing) {
    // Rounded the safe way: the carry up, the edge to stay short of down.
    if (targetYds > metresToYards(crossing.farM)) {
      return `Water crosses your line: ${Math.ceil(metresToYards(crossing.farM))} to carry it.`;
    }
    if (targetYds < metresToYards(crossing.nearM)) {
      return `Water past your target at ${Math.floor(metresToYards(crossing.nearM))}.`;
    }
    // The target sits in the water, which the plan's own lay-up reason already speaks to.
    return null;
  }

  let beside: "left" | "right" | null = null;
  for (const outline of water) {
    if (beside) break;
    for (const point of walkOutline(outline)) {
      const { x, y } = projection.toXY(point);
      const alongYds = metresToYards(x * along.x + y * along.y);
      const lateralYds = metresToYards(x * rightward.x + y * rightward.y);
      if (alongYds < landingNearYds || alongYds > landingFarYds) continue;
      if (Math.abs(lateralYds) > dispersion.lateralYds + 5) continue;
      beside = lateralYds < 0 ? "left" : "right";
      break;
    }
  }

  return beside ? `Water ${beside} of your landing area.` : null;
}
