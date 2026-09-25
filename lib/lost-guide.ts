import {
  angleDeltaDeg,
  bearingDeg,
  haversineM,
  localProjection,
  metresToYards,
  nearestPointOnPath,
  nearestPointOnSegment,
  pathLengthM,
  pointAlongPath,
  pointInPolygon,
  yardsToMetres,
  type XY,
} from "./geo";
import type { CourseHazard, LatLng, PlayingHoleGeometry } from "./hole-geometry";

/**
 * Getting back to the right hole after wandering onto the wrong one. Pure; no storage, no
 * rendering.
 *
 * Everything here is measured from the mapped holes, so it says nothing it cannot back up:
 * a landmark is only named when it is plainly the nearest one, and water is only mentioned
 * where a mapped outline actually crosses the way.
 */

/** Within this of the tee box, you have made it back. */
export const ARRIVED_M = 30;
/** Once arrived, it takes this much to count as having left again, so a wobbling fix cannot flicker. */
export const LEFT_AGAIN_M = 55;
/**
 * Forward tees rarely sit further up than this from the tips. Past it the scorecard and the
 * map disagree about the hole, and the start of the mapped line is the safer guess.
 */
const MAX_FORWARD_TEE_M = 120;
/** A green this close to the tee is worth naming as the way to find it. */
const LANDMARK_GREEN_M = 90;
/** Where the map draws no green outline, a green is about this wide from its centre. */
const ASSUMED_GREEN_RADIUS_M = 14;
const BY_GREEN_M = 20;
const ON_TEE_M = 25;
const ON_HOLE_M = 35;
/** How much nearer one hole must be than any other before saying you are on it. */
const WHERE_MARGIN_M = 20;

export interface PlayingTee {
  point: LatLng;
  /** How far up the hole's mapped line the tee sits, from its start. */
  alongM: number;
}

/**
 * Where the tee on the scorecard most likely sits.
 *
 * Mapped hole lines start at the back tee, so a forward tee is further up. A scorecard
 * measures along the line of play to the green, so the tee is that far back from the green
 * along the line, and never behind the line's own start.
 */
export function playingTee(hole: PlayingHoleGeometry, scorecardYards: number): PlayingTee {
  const lengthM = pathLengthM(hole.centreline);
  const forwardM = scorecardYards > 0 ? lengthM - yardsToMetres(scorecardYards) : 0;
  const alongM = forwardM > 0 && forwardM <= MAX_FORWARD_TEE_M ? forwardM : 0;
  return { point: pointAlongPath(hole.centreline, alongM), alongM };
}

/**
 * How far you are from the tee box: anywhere between the back tee and the tee being played
 * counts, because that whole stretch is tee boxes.
 */
export function distanceToTeeBoxM(from: LatLng, hole: PlayingHoleGeometry, tee: PlayingTee): number {
  const nearest = nearestPointOnPath(hole.centreline, from);
  const toTee = haversineM(from, tee.point);
  return nearest.alongM <= tee.alongM ? Math.min(nearest.distanceM, toTee) : toTee;
}

export interface Whereabouts {
  number: number;
  part: "tee" | "green" | "fairway";
}

function greenDistanceM(from: LatLng, hole: PlayingHoleGeometry): number {
  if (hole.greenPolygon && pointInPolygon(from, hole.greenPolygon)) return 0;
  return Math.max(0, haversineM(from, hole.greenCentre) - ASSUMED_GREEN_RADIUS_M);
}

/**
 * Which hole you are standing on, and where on it. Null when nothing is close, or when two
 * holes are about as close as each other, which is exactly where a wrong answer would send
 * someone further astray.
 */
export function whereYouAre(from: LatLng, holes: PlayingHoleGeometry[]): Whereabouts | null {
  const candidates = holes
    .map((hole) => {
      const green = greenDistanceM(from, hole);
      const tee = haversineM(from, hole.tee);
      const line = nearestPointOnPath(hole.centreline, from).distanceM;
      const part: Whereabouts["part"] | null =
        green <= BY_GREEN_M ? "green" : tee <= ON_TEE_M ? "tee" : line <= ON_HOLE_M ? "fairway" : null;
      return { number: hole.number, part, distanceM: Math.min(green, tee, line), onGreen: green === 0 };
    })
    .sort((left, right) => left.distanceM - right.distanceM);

  const best = candidates[0];
  if (!best?.part) return null;
  // Standing on a mapped green settles it, whatever else is nearby.
  if (!best.onGreen) {
    const runnerUp = candidates.find((candidate) => candidate.number !== best.number);
    if (runnerUp && runnerUp.distanceM - best.distanceM < WHERE_MARGIN_M) return null;
  }
  return { number: best.number, part: best.part };
}

/** The green nearest a tee, when it is close enough to steer by. Never the hole's own green. */
export function greenNearTee(tee: LatLng, targetNumber: number, holes: PlayingHoleGeometry[]): number | null {
  let nearest: { number: number; distanceM: number } | null = null;
  for (const hole of holes) {
    if (hole.number === targetNumber) continue;
    const distanceM = greenDistanceM(tee, hole);
    if (distanceM <= LANDMARK_GREEN_M && (!nearest || distanceM < nearest.distanceM)) {
      nearest = { number: hole.number, distanceM };
    }
  }
  return nearest?.number ?? null;
}

function segmentsCross(a: XY, b: XY, c: XY, d: XY): boolean {
  const side = (p: XY, q: XY, r: XY) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abC = side(a, b, c);
  const abD = side(a, b, d);
  const cdA = side(c, d, a);
  const cdB = side(c, d, b);
  return abC * abD < 0 && cdA * cdB < 0;
}

/**
 * Whether mapped water lies across the straight walk from one point to another.
 *
 * Only water: it is the one thing on a course nobody walks through, and the most reliably
 * mapped. Trees and bunkers are walked around without being told.
 */
export function waterOnTheWay(from: LatLng, to: LatLng, hazards: CourseHazard[]): boolean {
  const projection = localProjection(from);
  const start = projection.toXY(from);
  const end = projection.toXY(to);

  return hazards.some((hazard) => {
    if (hazard.kind !== "water" && hazard.kind !== "lateral_water") return false;
    if (hazard.outline.length < 3) {
      // A copy saved before water kept its shape: judge it by its circle.
      const nearest = nearestPointOnSegment(from, to, hazard.centre).point;
      return haversineM(nearest, hazard.centre) < hazard.radiusM;
    }
    if (pointInPolygon(to, hazard.outline)) return true;
    const ring = hazard.outline.map(projection.toXY);
    return ring.some((point, index) => segmentsCross(start, end, point, ring[(index + 1) % ring.length]));
  });
}

export interface LostGuidance {
  tee: PlayingTee;
  distanceYds: number;
  /** Compass bearing from you to the tee. */
  bearingDeg: number;
  /** How far from the tee box, which is what decides whether you have made it. */
  teeBoxM: number;
  waterOnTheWay: boolean;
  /** A green right by the tee, to look out for. */
  teeByGreen: number | null;
  here: Whereabouts | null;
}

export interface GuideInput {
  from: LatLng;
  hole: PlayingHoleGeometry;
  /** Scorecard yardage from the tee being played. */
  yards: number;
  holes: PlayingHoleGeometry[];
  hazards: CourseHazard[];
}

export function guideToHole({ from, hole, yards, holes, hazards }: GuideInput): LostGuidance {
  const tee = playingTee(hole, yards);
  const here = whereYouAre(from, holes);
  const landmark = greenNearTee(tee.point, hole.number, holes);
  return {
    tee,
    distanceYds: metresToYards(haversineM(from, tee.point)),
    bearingDeg: bearingDeg(from, tee.point),
    teeBoxM: distanceToTeeBoxM(from, hole, tee),
    waterOnTheWay: waterOnTheWay(from, tee.point, hazards),
    // Naming the green you are already standing by says nothing useful.
    teeByGreen: here?.part === "green" && here.number === landmark ? null : landmark,
    here,
  };
}

/**
 * Whether you have made it, with a little stickiness: once there, a fix has to wander well
 * clear of the tee before it counts as having left.
 */
export function hasArrived(teeBoxM: number, wasArrived: boolean): boolean {
  return teeBoxM <= (wasArrived ? LEFT_AGAIN_M : ARRIVED_M);
}

export type Turn = "ahead" | "bear-left" | "bear-right" | "left" | "right" | "behind";

/** Which way to turn, from the way you face to the way you need to go. */
export function turnToward(headingDeg: number, targetBearingDeg: number): { relativeDeg: number; turn: Turn } {
  const relativeDeg = angleDeltaDeg(headingDeg, targetBearingDeg);
  const size = Math.abs(relativeDeg);
  const side = relativeDeg < 0 ? "left" : "right";
  if (size <= 20) return { relativeDeg, turn: "ahead" };
  if (size <= 60) return { relativeDeg, turn: side === "left" ? "bear-left" : "bear-right" };
  if (size <= 135) return { relativeDeg, turn: side };
  return { relativeDeg, turn: "behind" };
}

export const TURN_TEXT: Record<Turn, string> = {
  ahead: "Straight ahead",
  "bear-left": "Bear left",
  "bear-right": "Bear right",
  left: "Turn left",
  right: "Turn right",
  behind: "Turn around",
};

const COMPASS_POINTS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];

export function compassWord(bearing: number): string {
  return COMPASS_POINTS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];
}

/** 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st. */
export function ordinal(value: number): string {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${value}th`;
  const suffix = ["th", "st", "nd", "rd"][value % 10] ?? "th";
  return `${value}${suffix}`;
}

export function whereaboutsText(here: Whereabouts): string {
  if (here.part === "green") return `You're by the ${ordinal(here.number)} green.`;
  if (here.part === "tee") return `You're on the ${ordinal(here.number)} tee.`;
  return `You're on hole ${here.number}.`;
}
