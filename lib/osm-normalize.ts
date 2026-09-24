import {
  bearingDeg,
  destination,
  haversineM,
  localProjection,
  nearestPointOnPath,
  pathLengthM,
  pointAlongPath,
  pointInPolygon,
  polygonCentroid,
  polygonRadiusM,
  simplifyPath,
  simplifyWithin,
  yardsToMetres,
} from "./geo";
import type {
  CourseGeometry,
  CourseHazard,
  HazardKind,
  HoleMap,
  LatLng,
  OsmHoleGeometry,
  TreeArea,
} from "./hole-geometry";
import { OSM_ATTRIBUTION } from "./hole-geometry";
import type { OverpassElement } from "./overpass";
import { normalizeTee } from "./tee-selection";

/** Turns a raw Overpass response into cacheable geometry. Pure: no network, no storage. */

const MAX_CENTRELINE_POINTS = 12;
const MAX_GREEN_POINTS = 24;
/**
 * Hazard and tree outlines are drawn and measured against, so they are simplified to a
 * tolerance, never to a point budget. Squeezing a riverbank into sixteen points would move
 * its edge tens of metres; this keeps every edge within a few metres of the mapped one.
 */
const OUTLINE_TOLERANCES_M = [1, 2, 3];
const OUTLINE_TARGET_POINTS = 48;
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

/** Water that may be dry on the day, or is not open water at all. */
const UNRELIABLE_WATER = new Set(["basin", "wastewater", "fountain", "reflecting_pool"]);
/** More than this share of a hole's line inside a wood means the wood was drawn over the fairway. */
const MAX_LINE_INSIDE_TREES = 0.2;

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
  /** The course's name as the scorecard has it. Picks the course out when several share a park. */
  courseName?: string;
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

function faithfulOutline(points: LatLng[]): LatLng[] {
  let outline = points;
  for (const toleranceM of OUTLINE_TOLERANCES_M) {
    outline = simplifyWithin(points, toleranceM);
    if (outline.length <= OUTLINE_TARGET_POINTS) break;
  }
  return outline;
}

/**
 * What a feature is, as a hazard. A golf mapper's tag wins; failing that, standing water is
 * water, because a pond beside a fairway is often only mapped as a pond.
 */
function hazardKindOf(tags: Record<string, string> | undefined): HazardKind | null {
  if (!tags) return null;
  const golfKind = HAZARD_KINDS[tags.golf ?? ""];
  if (golfKind) return golfKind;
  if (tags.natural !== "water") return null;
  if (tags.intermittent === "yes" || tags.seasonal === "yes" || tags.covered === "yes" || tags.tunnel) return null;
  if (UNRELIABLE_WATER.has(tags.water ?? "")) return null;
  return "water";
}

function isTreeCover(tags: Record<string, string> | undefined): boolean {
  return tags?.natural === "wood" || tags?.landuse === "forest";
}

/** Nearest approach of an outline to a line, or zero where the line runs through it. */
function outlineDistanceToPathM(outline: LatLng[], path: LatLng[]): number {
  let best = Infinity;
  for (const point of outline) best = Math.min(best, nearestPointOnPath(path, point).distanceM);
  for (const point of path) {
    if (pointInPolygon(point, outline)) return 0;
    best = Math.min(best, nearestPointOnPath(outline, point).distanceM);
  }
  return best;
}

const LINE_SAMPLES = 40;

function shareOfLineInside(path: LatLng[], outline: LatLng[]): number {
  const lengthM = pathLengthM(path);
  if (lengthM < 1) return 0;
  let inside = 0;
  for (let step = 0; step <= LINE_SAMPLES; step += 1) {
    if (pointInPolygon(pointAlongPath(path, (lengthM * step) / LINE_SAMPLES), outline)) inside += 1;
  }
  return inside / (LINE_SAMPLES + 1);
}

/**
 * A water or tree outline sitting on a green or a tee was drawn carelessly, since nobody
 * putts on a pond. Leaving it in would put an obstacle where there is none, so it goes.
 */
function coversPlayingSurface(outline: LatLng[], holes: OsmHoleGeometry[]): boolean {
  return holes.some((hole) => pointInPolygon(hole.greenCentre, outline) || pointInPolygon(hole.tee, outline));
}

/**
 * Keeps only hazards that come into play.
 *
 * In play is judged against this course's own holes, not against whose outline the hazard
 * sits in. A pond between two courses in the same park is in play on both.
 */
function readHazards(elements: OverpassElement[], holes: OsmHoleGeometry[]): CourseHazard[] {
  const hazards: CourseHazard[] = [];
  for (const element of elements) {
    const kind = hazardKindOf(element.tags);
    if (!kind) continue;
    const outline = geometryOf(element);
    if (outline.length < 3) continue;

    const centre = polygonCentroid(outline);
    const radiusM = polygonRadiusM(outline, centre);
    const inPlay = holes.some(
      (hole) => nearestPointOnPath(hole.centreline, centre).distanceM - radiusM <= HAZARD_CORRIDOR_M,
    );
    if (!inPlay) continue;
    if (kind !== "out_of_bounds" && coversPlayingSurface(outline, holes)) continue;

    hazards.push({ osmId: elementRef(element), kind, outline: faithfulOutline(outline), centre, radiusM });
  }
  return hazards;
}

/** Hazards and trees for holes already known, so a cached course can gain them without re-matching. */
export function readCourseObstacles(
  elements: OverpassElement[],
  holes: OsmHoleGeometry[],
): { hazards: CourseHazard[]; trees: TreeArea[] } {
  return { hazards: readHazards(elements, holes), trees: readTrees(elements, holes) };
}

/**
 * Wood and forest outlines beside this course's holes.
 *
 * Trees are only as complete as the local mappers made them: a clump drawn is a clump that
 * is there, but a tree not drawn is not a gap. Nothing downstream may read their absence as
 * a clear line.
 */
function readTrees(elements: OverpassElement[], holes: OsmHoleGeometry[]): TreeArea[] {
  const trees: TreeArea[] = [];
  for (const element of elements) {
    if (!isTreeCover(element.tags)) continue;
    const outline = geometryOf(element);
    if (outline.length < 4) continue;

    const inPlay = holes.some((hole) => outlineDistanceToPathM(outline, hole.centreline) <= HAZARD_CORRIDOR_M);
    if (!inPlay) continue;
    if (coversPlayingSurface(outline, holes)) continue;
    if (holes.some((hole) => shareOfLineInside(hole.centreline, outline) > MAX_LINE_INSIDE_TREES)) continue;

    const centre = polygonCentroid(outline);
    trees.push({
      osmId: elementRef(element),
      outline: faithfulOutline(outline),
      centre,
      radiusM: polygonRadiusM(outline, centre),
    });
  }
  return trees;
}

interface CourseCandidate {
  element: OverpassElement;
  centre: LatLng;
  outline: LatLng[] | null;
}

function readCourseCandidates(elements: OverpassElement[]): CourseCandidate[] {
  // A course can arrive twice, once with its centre and once with its outline, when the query
  // asks for both. Folded into one, it keeps both.
  const courses = new Map<string, OverpassElement>();
  for (const element of elements) {
    if (element.tags?.leisure !== "golf_course") continue;
    const seen = courses.get(elementRef(element));
    courses.set(elementRef(element), seen
      ? { ...seen, ...element, center: element.center ?? seen.center, geometry: element.geometry?.length ? element.geometry : seen.geometry }
      : element);
  }

  const candidates: CourseCandidate[] = [];
  for (const element of courses.values()) {
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

const GENERIC_NAME_WORDS = new Set(["the", "golf", "course", "club", "country", "links", "and", "at", "of"]);

/** A course name reduced to the words that tell it apart: "Genesee Valley Golf Course — South" is "genesee valley south". */
export function distinctiveCourseName(name: string): string {
  return normalizeTee(name)
    .split(" ")
    .filter((word) => word && !GENERIC_NAME_WORDS.has(word))
    .join(" ");
}

/**
 * Whether two names say these are different courses. A blank name, such as a green captured by
 * hand, says nothing either way.
 */
export function namesDifferentCourse(wanted: string, candidate: string): boolean {
  const left = distinctiveCourseName(wanted);
  const right = distinctiveCourseName(candidate);
  return Boolean(left && right) && left !== right;
}

function readCourseIdentity(
  elements: OverpassElement[],
  fix: LatLng,
  holes: OsmHoleGeometry[],
  courseName?: string,
): { id: string; name: string; centre: LatLng } {
  const courses = readCourseCandidates(elements);
  // Two courses can share a park and a clubhouse, with holes of one nearer the other's centre.
  // When the scorecard's name picks one out, the name settles it; otherwise the nearest wins.
  const wanted = courseName ? distinctiveCourseName(courseName) : "";
  const named = wanted
    ? courses.filter((candidate) => distinctiveCourseName(candidate.element.tags?.name ?? "") === wanted)
    : [];
  let best: { element: OverpassElement; centre: LatLng; distanceM: number } | null = null;
  for (const candidate of named.length ? named : courses) {
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

/** A hole whose OSM tags agree with this scorecard's hole of the same number. */
function matchesScorecard(hole: OsmHoleGeometry, card: ScorecardHole[]): boolean {
  const entry = card.find((item) => String(item.number) === hole.ref);
  if (!entry || hole.par !== entry.par) return false;
  return hole.handicap === null || hole.handicap === entry.handicap;
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
  const identity = readCourseIdentity(input.elements, input.fix, allHoles, input.courseName);

  // Drop anything belonging to a neighbouring course before numbering begins, so hole 1 is
  // this course's hole 1 and not the one next door that happens to share the number.
  const candidates = readCourseCandidates(input.elements);
  const chosen = candidates.find((candidate) => elementRef(candidate.element) === identity.id);
  const namedByScorecard =
    Boolean(input.courseName) &&
    distinctiveCourseName(chosen?.element.tags?.name ?? "") === distinctiveCourseName(input.courseName ?? "");
  const holes = chosen
    ? allHoles.filter((hole) =>
        belongsToCourse(hole.greenCentre, chosen, candidates) ||
        // Without an outline the nearest centre can hand one of this course's holes to the
        // course next door. When the scorecard named this course, a hole tagged with this
        // card's number, par and handicap stays in, and the assignment below chooses between it
        // and any look-alike from next door by length and the walk from the previous green.
        (namedByScorecard && !chosen.outline && matchesScorecard(hole, input.holes)))
    : allHoles;

  const hazards = readHazards(input.elements, holes);
  const trees = readTrees(input.elements, holes);
  const holeMap = assignHoles(holes, input.holes);

  return {
    geometry: {
      id: identity.id,
      name: identity.name,
      centre: identity.centre,
      holes,
      hazards,
      trees,
      source: "osm",
      attribution: OSM_ATTRIBUTION,
      fetchedAt: new Date().toISOString(),
    },
    holeMap,
    unmatched: input.holes.filter((hole) => !holeMap[hole.number]).map((hole) => hole.number),
  };
}
