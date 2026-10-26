import type { Bag, Club, ClubPick } from "./bag";
import { longestCarry, longestClubWithin, pickClub, shortestCarry, stepDown } from "./bag";
import {
  bearingDeg,
  destination,
  haversineM,
  metresToYards,
  nearestPointOnPath,
  pathLengthM,
  pointAlongPath,
  pointInPolygon,
  yardsToMetres,
} from "./geo";
import type { CourseHazard, LatLng, PlayingHoleGeometry } from "./hole-geometry";

/** Turns a position on a hole into a target and a club. Pure; no storage, no rendering. */

/** Inside this of the green centre with no polygon mapped, treat the ball as holed out. */
const ASSUMED_GREEN_RADIUS_M = 14;
/** Up to this from the green, it is a short-game shot and no full club is named. */
const SHORT_GAME_YDS = 40;
/** Within this of the tee you are still on the tee box. */
const TEE_BOX_M = 25;
/** A club can stretch this far past its carry before the shot stops being an approach. */
const APPROACH_REACH_YDS = 10;
/** Beyond this from the centreline you are in recovery, not in position. */
const OFF_LINE_RECOVERY_YDS = 25;
/** Half-width of the corridor a shot is checked against for hazards. */
const HAZARD_CORRIDOR_YDS = 18;

/** Roll after landing, as a fraction of carry: a driver runs out, a wedge stops. */
const MOST_ROLL = 0.09;
const LEAST_ROLL = 0.015;

/** Lateral spread as a fraction of the shot, widest with a driver and tightest with a wedge. */
const WIDEST_DISPERSION = 0.075;
const TIGHTEST_DISPERSION = 0.035;
const MIN_LONG_DISPERSION_YDS = 6;

export type ShotKind = "tee" | "layup" | "approach" | "short-game" | "putt";

export interface GreenDistances {
  frontYds: number;
  centreYds: number;
  backYds: number;
}

export interface ShotContext {
  kind: ShotKind;
  toGreenYds: number;
  onGreen: boolean;
  /** How far off the hole's centreline you are, which is how much trouble you are in. */
  offCentrelineYds: number;
  atTee: boolean;
}

export interface HazardCarry {
  hazard: CourseHazard;
  /** Distance along the shot line to the near edge. */
  nearEdgeYds: number;
  farEdgeYds: number;
  /** True when the chosen target finishes beyond the far edge. */
  carried: boolean;
}

/** The shot after this one, from the target into the middle of the green. */
export interface ShotLeave {
  yds: number;
  /** Null inside short-game range, where no full club is named. */
  club: Club | null;
}

export interface ShotPlan {
  kind: ShotKind;
  target: LatLng;
  targetYds: number;
  /** Null for a putt, where naming a club would be nonsense. */
  club: ClubPick | null;
  bearingDeg: number;
  carries: HazardCarry[];
  /** True when a hazard forced a shorter club than the distance would suggest. */
  laidUp: boolean;
  /** True when the target is the hole's centreline rather than the green. */
  recovering: boolean;
  dispersion: { lateralYds: number; longYds: number };
  /** Run-out past the landing point. Drawn as the dashed tail of the shot line. */
  rollYds: number;
  green: GreenDistances;
  onGreen: boolean;
  /** Plain-language reason for the target, shown under the club. Empty when there is none. */
  reason: string;
  /** Null when the target is on the green, so the next shot is a putt. */
  leave: ShotLeave | null;
  /** True when the golfer moved the target on the map rather than taking the caddy's. */
  custom: boolean;
}

export function greenDistances(from: LatLng, hole: PlayingHoleGeometry): GreenDistances {
  return {
    frontYds: metresToYards(haversineM(from, hole.greenFront)),
    centreYds: metresToYards(haversineM(from, hole.greenCentre)),
    backYds: metresToYards(haversineM(from, hole.greenBack)),
  };
}

export function isOnGreen(from: LatLng, hole: PlayingHoleGeometry): boolean {
  if (hole.greenPolygon && hole.greenPolygon.length >= 3) {
    return pointInPolygon(from, hole.greenPolygon);
  }
  return haversineM(from, hole.greenCentre) <= ASSUMED_GREEN_RADIUS_M;
}

export function classifyShot(
  from: LatLng,
  hole: PlayingHoleGeometry,
  longestCarryYds: number,
): ShotContext {
  const onGreen = isOnGreen(from, hole);
  const toGreenYds = metresToYards(haversineM(from, hole.greenCentre));
  const nearest = nearestPointOnPath(hole.centreline, from);
  const offCentrelineYds = metresToYards(nearest.distanceM);
  const atTee = haversineM(from, hole.tee) <= TEE_BOX_M;

  // Reachability is asked before position, not after. A par 3 is played from the tee box
  // but it is an approach: the green is the target, and there is nothing to lay up for.
  let kind: ShotKind;
  if (onGreen) kind = "putt";
  else if (toGreenYds <= SHORT_GAME_YDS) kind = "short-game";
  else if (toGreenYds <= longestCarryYds + APPROACH_REACH_YDS) kind = "approach";
  else if (atTee) kind = "tee";
  else kind = "layup";

  return { kind, toGreenYds, onGreen, offCentrelineYds, atTee };
}

/** How far past the target to keep looking, so water just beyond the landing zone counts. */
const LOOK_BEYOND_TARGET = 1.25;
/** Steps taken along the shot line when measuring how much of it a hazard covers. */
const LINE_SAMPLES = 48;

/**
 * The stretch of the shot line a hazard actually covers, in metres from the player.
 *
 * Walking the line and asking "is this point in the water" is the only honest way to
 * measure an irregular hazard. Treating one as a circle round its centre is wildly wrong
 * for real water: the pond on Arrowhead's first hole has a 97 yard radius, so as a circle
 * it reads as 194 yards of carry straight across a 269 yard hole, and no club on earth
 * clears it. Its actual crossing is a fraction of that.
 *
 * Bunkers keep the circle. They carry no outline and are small and round enough that it
 * costs nothing.
 */
function hazardExtentM(
  from: LatLng,
  to: LatLng,
  hazard: CourseHazard,
  corridorM: number,
): { nearM: number; farM: number } | null {
  const shotM = haversineM(from, to);
  const hasOutline = hazard.outline.length >= 3;

  if (!hasOutline) {
    const nearest = nearestPointOnPath([from, to], hazard.centre);
    if (nearest.distanceM - hazard.radiusM > corridorM) return null;
    return { nearM: nearest.alongM - hazard.radiusM, farM: nearest.alongM + hazard.radiusM };
  }

  const bearing = bearingDeg(from, to);
  const reach = shotM * LOOK_BEYOND_TARGET;
  // Every vertex sits within the radius of the centre, so a line that clears that circle by
  // more than the corridor cannot touch the outline. Skipping those keeps a dragged target
  // from walking every pond and bunker on the course on each frame.
  const clearance = nearestPointOnPath([from, destination(from, bearing, reach)], hazard.centre);
  if (clearance.distanceM - hazard.radiusM > corridorM) return null;

  // A closed ring, so the edge nearest a sample is measured rather than only the vertices.
  const ring = [...hazard.outline, hazard.outline[0]];

  let nearM = Infinity;
  let farM = -Infinity;
  for (let step = 0; step <= LINE_SAMPLES; step += 1) {
    const alongM = (reach * step) / LINE_SAMPLES;
    const point = destination(from, bearing, alongM);
    const covered =
      pointInPolygon(point, hazard.outline) ||
      nearestPointOnPath(ring, point).distanceM <= corridorM;
    if (!covered) continue;
    nearM = Math.min(nearM, alongM);
    farM = Math.max(farM, alongM);
  }

  return farM < nearM ? null : { nearM, farM };
}

/**
 * Hazards the shot line crosses, as carry numbers, nearest first.
 */
export function hazardsOnLine(
  from: LatLng,
  to: LatLng,
  hazards: CourseHazard[],
  corridorYds = HAZARD_CORRIDOR_YDS,
): HazardCarry[] {
  const shotM = haversineM(from, to);
  if (shotM < 1) return [];

  const corridorM = yardsToMetres(corridorYds);
  const carries: HazardCarry[] = [];

  for (const hazard of hazards) {
    const extent = hazardExtentM(from, to, hazard, corridorM);
    if (!extent) continue;
    // Behind the player, or past where the ball is going: not in the way.
    if (extent.farM <= 0 || extent.nearM >= shotM + hazard.radiusM) continue;

    carries.push({
      hazard,
      nearEdgeYds: metresToYards(Math.max(0, extent.nearM)),
      farEdgeYds: metresToYards(extent.farM),
      carried: metresToYards(shotM) > metresToYards(extent.farM),
    });
  }

  return carries.sort((left, right) => left.nearEdgeYds - right.nearEdgeYds);
}

/** True when the target finishes inside a hazard rather than short of it or beyond it. */
function landsInHazard(targetYds: number, carries: HazardCarry[]): HazardCarry | null {
  return carries.find((carry) => targetYds > carry.nearEdgeYds && targetYds <= carry.farEdgeYds) ?? null;
}

/**
 * Roll scales with how flat the club is hit. Not a ballistics model, but it is the
 * difference between a drive that runs and a wedge that checks, which is what the drawn
 * shot has to show: a top-down map has no apex, so run-out is where loft becomes visible.
 */
export function rollYardsFor(club: Club | null, bag: Bag, kind: ShotKind): number {
  if (!club || kind === "putt" || kind === "short-game") return 0;
  const longest = longestCarry(bag) || 1;
  const ratio = Math.min(1, club.carryYds / longest);
  return club.carryYds * (LEAST_ROLL + (MOST_ROLL - LEAST_ROLL) * ratio);
}

function dispersionFor(club: Club | null, bag: Bag, targetYds: number, accuracyM: number) {
  const longest = longestCarry(bag) || 1;
  const ratio = club ? Math.min(1, club.carryYds / longest) : 0.5;
  const lateralRatio = TIGHTEST_DISPERSION + (WIDEST_DISPERSION - TIGHTEST_DISPERSION) * ratio;
  // GPS error is real uncertainty about where you are standing, so it widens the picture
  // rather than being tucked away in a footnote.
  const gpsYds = metresToYards(Math.max(0, accuracyM));
  return {
    lateralYds: targetYds * lateralRatio + gpsYds,
    longYds: Math.max(MIN_LONG_DISPERSION_YDS, targetYds * 0.06) + gpsYds,
  };
}

export interface PlanShotInput {
  from: LatLng;
  hole: PlayingHoleGeometry;
  hazards: CourseHazard[];
  bag: Bag;
  accuracyM: number;
}

interface TargetChoice {
  target: LatLng;
  club: Club | null;
  laidUp: boolean;
  recovering: boolean;
  reason: string;
  /** What forced the layup, kept so the readout can name the number being laid up to. */
  blockedBy: HazardCarry | null;
}

/** Walks the centreline to the point a full swing would reach, never past the green. */
function advanceTarget(from: LatLng, hole: PlayingHoleGeometry, bag: Bag): LatLng {
  const nearest = nearestPointOnPath(hole.centreline, from);
  const reachM = yardsToMetres(longestCarry(bag));
  const totalM = pathLengthM(hole.centreline);
  // Leave at least a short club into the green: a layup that runs through it is not a plan.
  const greenApproachM = haversineM(hole.greenFront, hole.greenCentre);
  const latestM = Math.max(0, totalM - greenApproachM - yardsToMetres(shortestCarry(bag)));
  return pointAlongPath(hole.centreline, Math.min(nearest.alongM + reachM, latestM));
}

function chooseTarget(input: PlanShotInput, context: ShotContext): TargetChoice {
  const { from, hole, bag, hazards } = input;

  if (context.kind === "putt") {
    return {
      target: hole.greenCentre,
      club: null,
      laidUp: false,
      recovering: false,
      reason: "On the green.",
      blockedBy: null,
    };
  }

  if (context.kind === "short-game" || context.kind === "approach") {
    const distanceYds = metresToYards(haversineM(from, hole.greenCentre));
    const pick = pickClub(bag, distanceYds);
    const recovering = context.offCentrelineYds > OFF_LINE_RECOVERY_YDS;
    return {
      target: hole.greenCentre,
      club: pick?.club ?? null,
      laidUp: false,
      recovering,
      reason: recovering
        ? "Centre of the green — take the safe line back."
        : "Centre of the green.",
      blockedBy: null,
    };
  }

  // Tee shot or layup: advance down the hole, then back off for anything in the way.
  const advanced = advanceTarget(from, hole, bag);
  const straightYds = metresToYards(haversineM(from, advanced));
  let club = pickClub(bag, straightYds)?.club ?? null;
  let target = advanced;
  let laidUp = false;
  let blockedBy: HazardCarry | null = null;
  let reason = context.kind === "tee" ? "Position off the tee." : "Advance down the fairway.";

  for (let guard = 0; guard < bag.clubs.length && club; guard += 1) {
    const carries = hazardsOnLine(from, target, hazards);
    const trouble = landsInHazard(metresToYards(haversineM(from, target)), carries);
    if (!trouble) break;

    const shorter = stepDown(bag, club);
    const layupYds = Math.max(0, trouble.nearEdgeYds - 8);
    const shorterReaches = shorter && shorter.carryYds > trouble.farEdgeYds;

    if (shorterReaches) {
      // A shorter club still clears it — take that rather than laying up.
      club = shorter;
    } else {
      const layupClub = longestClubWithin(bag, layupYds);
      if (!layupClub) break;
      club = layupClub;
      laidUp = true;
      // Kept because once the target moves short of it this hazard stops intersecting the
      // line, and a readout saying "lay up" without saying what for is no use on a tee.
      blockedBy = trouble;
      reason = `Lay up short of the ${hazardLabel(trouble.hazard)} at ${Math.round(trouble.nearEdgeYds)}.`;
    }

    const nearest = nearestPointOnPath(hole.centreline, from);
    target = pointAlongPath(hole.centreline, nearest.alongM + yardsToMetres(club.carryYds));
  }

  const recovering = context.offCentrelineYds > OFF_LINE_RECOVERY_YDS;
  if (recovering && !laidUp) reason = "Back to the centre of the fairway.";

  return { target, club, laidUp, recovering, reason, blockedBy };
}

function hazardLabel(hazard: CourseHazard): string {
  if (hazard.kind === "bunker") return "bunker";
  if (hazard.kind === "out_of_bounds") return "boundary";
  return "water";
}

function leaveFor(target: LatLng, hole: PlayingHoleGeometry, bag: Bag): ShotLeave | null {
  if (isOnGreen(target, hole)) return null;
  const yds = metresToYards(haversineM(target, hole.greenCentre));
  return { yds, club: yds > SHORT_GAME_YDS ? (pickClub(bag, yds)?.club ?? null) : null };
}

/** The mapped hazard a point sits in, if any. */
function hazardAtPoint(point: LatLng, hazards: CourseHazard[]): CourseHazard | null {
  return (
    hazards.find((hazard) =>
      hazard.outline.length >= 3
        ? pointInPolygon(point, hazard.outline)
        : haversineM(point, hazard.centre) <= hazard.radiusM,
    ) ?? null
  );
}

function landingWarning(hazard: CourseHazard): string {
  if (hazard.kind === "bunker") return "That lands in a bunker.";
  if (hazard.kind === "out_of_bounds") return "That lands out of bounds.";
  return "That lands in the water.";
}

/**
 * The shot to a target the golfer put on the map themselves.
 *
 * Nothing is second-guessed: the club is whatever carries closest to the point, and a target
 * in the water is said to be in the water rather than quietly pulled short of it. The caddy's
 * own pick is still a tap away, so this only has to be honest about the choice made.
 */
export function planShotAt(input: PlanShotInput, aim: LatLng): ShotPlan {
  const { from, hole, bag, hazards, accuracyM } = input;
  const context = classifyShot(from, hole, longestCarry(bag));
  const targetYds = metresToYards(haversineM(from, aim));
  const pick = context.onGreen ? null : pickClub(bag, targetYds);
  const club = pick?.club ?? null;
  const landsIn = hazardAtPoint(aim, hazards);

  return {
    kind: context.kind,
    target: aim,
    targetYds,
    club: pick,
    bearingDeg: haversineM(from, aim) > 1 ? bearingDeg(from, aim) : bearingDeg(from, hole.greenCentre),
    carries: hazardsOnLine(from, aim, hazards).map((carry) => ({ ...carry, carried: targetYds > carry.farEdgeYds })),
    laidUp: false,
    recovering: false,
    dispersion: dispersionFor(club, bag, targetYds, accuracyM),
    rollYds: rollYardsFor(club, bag, context.kind),
    green: greenDistances(from, hole),
    onGreen: context.onGreen,
    reason: landsIn ? landingWarning(landsIn) : "",
    leave: leaveFor(aim, hole, bag),
    custom: true,
  };
}

export function planShot(input: PlanShotInput): ShotPlan {
  const { from, hole, bag, hazards, accuracyM } = input;
  const context = classifyShot(from, hole, longestCarry(bag));
  const choice = chooseTarget(input, context);

  const targetYds = metresToYards(haversineM(from, choice.target));
  const onLine = hazardsOnLine(from, choice.target, hazards).map((carry) => ({
    ...carry,
    carried: targetYds > carry.farEdgeYds,
  }));
  const carries =
    choice.blockedBy && !onLine.some((carry) => carry.hazard.osmId === choice.blockedBy!.hazard.osmId)
      ? [...onLine, { ...choice.blockedBy, carried: false }].sort((left, right) => left.nearEdgeYds - right.nearEdgeYds)
      : onLine;

  const pick = choice.club
    ? { club: choice.club, deltaYds: Math.round(choice.club.carryYds - targetYds), confident: Math.round(targetYds) <= longestCarry(bag), alternative: stepDown(bag, choice.club) }
    : null;

  return {
    kind: context.kind,
    target: choice.target,
    targetYds,
    club: pick,
    bearingDeg: haversineM(from, choice.target) > 1 ? bearingDeg(from, choice.target) : bearingDeg(from, hole.greenCentre),
    carries,
    laidUp: choice.laidUp,
    recovering: choice.recovering,
    dispersion: dispersionFor(choice.club, bag, targetYds, accuracyM),
    rollYds: rollYardsFor(choice.club, bag, context.kind),
    green: greenDistances(from, hole),
    onGreen: context.onGreen,
    reason: choice.reason,
    leave: leaveFor(choice.target, hole, bag),
    custom: false,
  };
}

/** How close a fix has to be, and how far clear of the runner-up, to change the hole. */
const HOLE_DETECT_LIMIT_M = 120;
const HOLE_DETECT_MARGIN_M = 40;

/**
 * Suggests which hole the fix is on. Never decisive on its own — the caller offers this as
 * a prompt, because a poor fix under trees must not silently move somebody's scorecard.
 */
export function detectHole(
  fix: LatLng,
  holes: PlayingHoleGeometry[],
  currentNumber: number,
): number {
  if (holes.length === 0) return currentNumber;

  const scored = holes
    .map((hole) => ({
      number: hole.number,
      distanceM: Math.min(
        nearestPointOnPath(hole.centreline, fix).distanceM,
        haversineM(fix, hole.tee),
        haversineM(fix, hole.greenCentre),
      ),
    }))
    .sort((left, right) => left.distanceM - right.distanceM);

  const best = scored[0];
  if (best.distanceM > HOLE_DETECT_LIMIT_M) return currentNumber;

  const runnerUp = scored[1];
  // Parallel fairways are the real failure mode; without a clear margin, say nothing.
  if (runnerUp && runnerUp.distanceM - best.distanceM < HOLE_DETECT_MARGIN_M) return currentNumber;

  return best.number;
}
