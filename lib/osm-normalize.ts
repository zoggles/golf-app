import {
  bearingDeg,
  destination,
  haversineM,
  localProjection,
  nearestPointOnPath,
  pathLengthM,
  pointInPolygon,
  polygonCentroid,
  polygonRadiusM,
  simplifyPath,
  yardsToMetres,
} from "./geo";
import type {
  CourseGeometry,
  CourseHazard,
  HazardKind,
  HoleMap,
  LatLng,
  OsmHoleGeometry,
} from "./hole-geometry";
import { OSM_ATTRIBUTION } from "./hole-geometry";
import type { OverpassElement } from "./overpass";

/** Turns a raw Overpass response into cacheable geometry. Pure: no network, no storage. */

const MAX_CENTRELINE_POINTS = 12;
const MAX_GREEN_POINTS = 24;
const MAX_HAZARD_POINTS = 16;
/** Beyond this a "nearby" green belongs to a different hole, so treat the hole as green-less. */
const GREEN_MATCH_LIMIT_M = 60;
/** Half the depth of a typical green, used when OSM mapped the hole but not the putting surface. */
const ASSUMED_GREEN_HALF_DEPTH_M = 9;
/** Hazards further than this from a centreline never come into play from the fairway. */
const HAZARD_CORRIDOR_M = 40;

const HAZARD_KINDS: Record<string, HazardKind> = {
  water_hazard: "water",
  lateral_water_hazard: "lateral_water",
  bunker: "bunker",
  out_of_bounds: "out_of_bounds",
};

export interface ScorecardHole {
  number: number;
  par: number;
  yards: number;
  handicap: number;
}

export interface NormalizeInput {
  elements: OverpassElement[];
  /** The player's fix, used to pick the nearest course when several are in range. */
  fix: LatLng;
  holes: ScorecardHole[];
}

export interface NormalizeResult {
  geometry: CourseGeometry;
  holeMap: HoleMap;
  /** Scorecard hole numbers that found no geometry, so the UI can offer to capture them. */
  unmatched: number[];
}

function toLatLng(point: { lat: number; lon: number }): LatLng {
  return { lat: point.lat, lng: point.lon };
}

function geometryOf(element: OverpassElement): LatLng[] {
  return (element.geometry ?? []).map(toLatLng);
}

function elementRef(element: OverpassElement): string {
  return `${element.type}/${element.id}`;
}

function numberTag(element: OverpassElement, key: string): number | null {
  const raw = element.tags?.[key];
  if (!raw) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : null;
}

interface GreenShape {
  centre: LatLng;
  polygon: LatLng[];
  radiusM: number;
}

function readGreens(elements: OverpassElement[]): GreenShape[] {
  return elements
    .filter((element) => element.tags?.golf === "green" && (element.geometry?.length ?? 0) >= 3)
    .map((element) => {
      const polygon = geometryOf(element);
      const centre = polygonCentroid(polygon);
      return {
        centre,
        polygon: simplifyPath(polygon, MAX_GREEN_POINTS),
        radiusM: polygonRadiusM(polygon, centre),
      };
    });
}

/**
 * Projects every green vertex onto the approach bearing and takes the extremes.
 *
 * Measured from the approach rather than from the player on purpose: front and back are
 * properties of the hole, so they must not swap over when you walk behind the green.
 */
function greenEdges(
  green: GreenShape | null,
  centre: LatLng,
  approachBearing: number,
): { front: LatLng; back: LatLng } {
  if (!green || green.polygon.length < 3) {
    return {
      front: destination(centre, approachBearing + 180, ASSUMED_GREEN_HALF_DEPTH_M),
      back: destination(centre, approachBearing, ASSUMED_GREEN_HALF_DEPTH_M),
    };
  }

  const projection = localProjection(centre);
  const radians = (approachBearing * Math.PI) / 180;
  // Unit vector pointing the way the approach shot travels.
  const ux = Math.sin(radians);
  const uy = Math.cos(radians);

  let front = green.polygon[0];
  let back = green.polygon[0];
  let least = Infinity;
  let most = -Infinity;
  for (const vertex of green.polygon) {
    const { x, y } = projection.toXY(vertex);
    const along = x * ux + y * uy;
    if (along < least) {
      least = along;
      front = vertex;
    }
    if (along > most) {
      most = along;
      back = vertex;
    }
  }
  return { front, back };
}

function readHoleWays(elements: OverpassElement[], greens: GreenShape[]): OsmHoleGeometry[] {
  const holeWays = elements.filter(
    (element) => element.tags?.golf === "hole" && (element.geometry?.length ?? 0) >= 2,
  );

  return holeWays.map((element) => {
    let centreline = geometryOf(element);
    const start = centreline[0];
    const end = centreline[centreline.length - 1];

    const nearestToStart = nearestGreen(greens, start);
    const nearestToEnd = nearestGreen(greens, end);
    const startGap = nearestToStart?.distanceM ?? Infinity;
    const endGap = nearestToEnd?.distanceM ?? Infinity;

    // Some hole ways are digitised green to tee. Only flip when the evidence is clear;
    // OSM convention is tee first, so an ambiguous way keeps the order it came in.
    if (startGap + 15 < endGap) centreline = [...centreline].reverse();

    centreline = simplifyPath(centreline, MAX_CENTRELINE_POINTS);
    const teeEnd = centreline[0];
    const greenEnd = centreline[centreline.length - 1];
    const match = nearestGreen(greens, greenEnd);
    const green = match && match.distanceM <= GREEN_MATCH_LIMIT_M ? match.green : null;

    // A hole way ends at the green centre by convention, so an unmapped putting surface
    // still yields a usable target rather than dropping the hole entirely.
    const greenCentre = green ? green.centre : greenEnd;
    const approachFrom = centreline[Math.max(0, centreline.length - 2)];
    const approachBearing =
      haversineM(approachFrom, greenCentre) > 1
        ? bearingDeg(approachFrom, greenCentre)
        : bearingDeg(teeEnd, greenCentre);
    const { front, back } = greenEdges(green, greenCentre, approachBearing);

    return {
      osmId: elementRef(element),
      ref: element.tags?.ref ?? null,
      par: numberTag(element, "par"),
      handicap: numberTag(element, "handicap"),
      tee: teeEnd,
      greenCentre,
      greenFront: front,
      greenBack: back,
      greenPolygon: green ? green.polygon : null,
      centreline,
      lengthM: pathLengthM(centreline),
    };
  });
}

function nearestGreen(
  greens: GreenShape[],
  point: LatLng,
): { green: GreenShape; distanceM: number } | null {
  let best: { green: GreenShape; distanceM: number } | null = null;
  for (const green of greens) {
    const distanceM = haversineM(green.centre, point);
    if (!best || distanceM < best.distanceM) best = { green, distanceM };
  }
  return best;
}

/**
 * Keeps only hazards that come into play, and stores bunkers as a circle.
 *
 * Duran alone maps 108 bunkers and 52 rough polygons; keeping every outline would put a
 * quarter of a megabyte into localStorage for one course. At the zoom the map draws at, a
 * bunker circle is indistinguishable from its outline.
 */
function readHazards(elements: OverpassElement[], holes: OsmHoleGeometry[]): CourseHazard[] {
  const hazards: CourseHazard[] = [];
  for (const element of elements) {
    const kind = HAZARD_KINDS[element.tags?.golf ?? ""];
    if (!kind) continue;
    const outline = geometryOf(element);
    if (outline.length < 3) continue;

    const centre = polygonCentroid(outline);
    const radiusM = polygonRadiusM(outline, centre);
    const inPlay = holes.some(
      (hole) => nearestPointOnPath(hole.centreline, centre).distanceM - radiusM <= HAZARD_CORRIDOR_M,
    );
    if (!inPlay) continue;

    hazards.push({
      osmId: elementRef(element),
      kind,
      outline: kind === "bunker" ? [] : simplifyPath(outline, MAX_HAZARD_POINTS),
      centre,
      radiusM,
    });
  }
  return hazards;
}

interface CourseCandidate {
  element: OverpassElement;
  centre: LatLng;
  outline: LatLng[] | null;
}

function readCourseCandidates(elements: OverpassElement[]): CourseCandidate[] {
  const candidates: CourseCandidate[] = [];
  for (const element of elements) {
    if (element.tags?.leisure !== "golf_course") continue;
    const outline = (element.geometry?.length ?? 0) >= 3 ? geometryOf(element) : null;
    const centre = element.center ? toLatLng(element.center) : outline ? polygonCentroid(outline) : null;
    if (!centre) continue;
    candidates.push({ element, centre, outline });
  }
  return candidates;
}

/**
 * Whether a feature belongs to this course rather than to a neighbouring one.
 *
 * Courses crowd together. Arrowhead in Spencerport sits about 1.3 km from Pinewood, well
 * inside the radius one query covers, so a blind radius hands back both courses' holes
 * with their numbers overlapping — and hole 1 could come out as the neighbour's.
 *
 * Being inside the course outline settles it. Where no outline is mapped, the nearest
 * course centre decides.
 */
function belongsToCourse(point: LatLng, chosen: CourseCandidate, all: CourseCandidate[]): boolean {
  if (all.length <= 1) return true;
  if (chosen.outline && pointInPolygon(point, chosen.outline)) return true;

  let nearest = all[0];
  let nearestDistance = haversineM(all[0].centre, point);
  for (const candidate of all.slice(1)) {
    // An outline the point sits inside beats any centre distance.
    if (candidate.outline && pointInPolygon(point, candidate.outline)) return false;
    const distance = haversineM(candidate.centre, point);
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return nearest.element === chosen.element;
}

function readCourseIdentity(
  elements: OverpassElement[],
  fix: LatLng,
  holes: OsmHoleGeometry[],
): { id: string; name: string; centre: LatLng } {
  const courses = readCourseCandidates(elements);
  let best: { element: OverpassElement; centre: LatLng; distanceM: number } | null = null;
  for (const candidate of courses) {
    const distanceM = haversineM(candidate.centre, fix);
    if (!best || distanceM < best.distanceM) {
      best = { element: candidate.element, centre: candidate.centre, distanceM };
    }
  }

  if (best) {
    return {
      id: elementRef(best.element),
      name: best.element.tags?.name ?? "",
      centre: best.centre,
    };
  }

  // No course polygon mapped, but the holes themselves are enough to identify the place.
  const fallbackId = holes.length
    ? `holes/${holes.map((hole) => hole.osmId).sort()[0].split("/")[1]}`
    : `holes/${Math.round(fix.lat * 1e5)}-${Math.round(fix.lng * 1e5)}`;
  const centre = holes.length ? polygonCentroid(holes.map((hole) => hole.greenCentre)) : fix;
  return { id: fallbackId, name: "", centre };
}

const PAR_MATCH_BONUS = 40;
const PAR_MISMATCH_PENALTY = 25;
const HANDICAP_MATCH_BONUS = 30;
const WALK_PENALTY_PER_METRE = 0.35;
const MAX_WALK_PENALTY = 200;

function assignmentScore(
  candidate: OsmHoleGeometry,
  hole: ScorecardHole,
  previousGreen: LatLng | null,
): number {
  let score = -Math.abs(candidate.lengthM - yardsToMetres(hole.yards));

  if (candidate.par !== null) {
    score += candidate.par === hole.par ? PAR_MATCH_BONUS : -PAR_MISMATCH_PENALTY;
  }
  if (candidate.handicap !== null && candidate.handicap === hole.handicap) {
    score += HANDICAP_MATCH_BONUS;
  }
  if (previousGreen) {
    // The walk from the last green is what separates two loops that share hole numbers:
    // the wrong nine racks up hundreds of metres of walking between consecutive holes.
    const walkM = haversineM(previousGreen, candidate.tee);
    score -= Math.min(MAX_WALK_PENALTY, walkM * WALK_PENALTY_PER_METRE);
  }
  return score;
}

/**
 * Greedy, deterministic, each geometry used at most once.
 *
 * Greedy rather than a search because the hole map is stored separately from the geometry,
 * so a bad assignment is repairable with one update instead of another Overpass fetch.
 */
export function assignHoles(candidates: OsmHoleGeometry[], holes: ScorecardHole[]): NormalizeResult["holeMap"] {
  const byRef = new Map<string, OsmHoleGeometry[]>();
  for (const candidate of candidates) {
    if (!candidate.ref) continue;
    const bucket = byRef.get(candidate.ref) ?? [];
    bucket.push(candidate);
    byRef.set(candidate.ref, bucket);
  }

  const used = new Set<string>();
  const holeMap: HoleMap = {};
  let previousGreen: LatLng | null = null;

  for (const hole of [...holes].sort((left, right) => left.number - right.number)) {
    const tagged = (byRef.get(String(hole.number)) ?? []).filter((item) => !used.has(item.osmId));
    const pool = tagged.length > 0 ? tagged : candidates.filter((item) => !used.has(item.osmId));
    if (pool.length === 0) continue;

    let best = pool[0];
    let bestScore = assignmentScore(best, hole, previousGreen);
    for (const candidate of pool.slice(1)) {
      const score = assignmentScore(candidate, hole, previousGreen);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    used.add(best.osmId);
    holeMap[hole.number] = best.osmId;
    previousGreen = best.greenCentre;
  }

  return holeMap;
}

export function normalizeOsmCourse(input: NormalizeInput): NormalizeResult {
  const greens = readGreens(input.elements);
  const allHoles = readHoleWays(input.elements, greens);
  const identity = readCourseIdentity(input.elements, input.fix, allHoles);

  // Drop anything belonging to a neighbouring course before numbering begins, so hole 1 is
  // this course's hole 1 and not the one next door that happens to share the number.
  const candidates = readCourseCandidates(input.elements);
  const chosen = candidates.find((candidate) => elementRef(candidate.element) === identity.id);
  const holes = chosen
    ? allHoles.filter((hole) => belongsToCourse(hole.greenCentre, chosen, candidates))
    : allHoles;

  const hazards = readHazards(input.elements, holes).filter(
    (hazard) => !chosen || belongsToCourse(hazard.centre, chosen, candidates),
  );
  const holeMap = assignHoles(holes, input.holes);

  return {
    geometry: {
      id: identity.id,
      name: identity.name,
      centre: identity.centre,
      holes,
      hazards,
      source: "osm",
      attribution: OSM_ATTRIBUTION,
      fetchedAt: new Date().toISOString(),
    },
    holeMap,
    unmatched: input.holes.filter((hole) => !holeMap[hole.number]).map((hole) => hole.number),
  };
}
