/**
 * Shapes for cached course geometry.
 *
 * Deliberately separate from `Hole` and `Course` in ./types. Every saved game freezes a
 * whole `Course` into its snapshot, so widening the scorecard would leave historical
 * rounds inconsistent. Geometry lives in its own tables and is joined at render time.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export type HazardKind = "water" | "lateral_water" | "bunker" | "out_of_bounds";

export interface CourseHazard {
  osmId: string;
  kind: HazardKind;
  /** Simplified outline. Empty for bunkers, which render from centre and radius. */
  outline: LatLng[];
  centre: LatLng;
  radiusM: number;
}

export interface OsmHoleGeometry {
  osmId: string;
  /** The OSM `ref` tag. Usually the hole number, but not reliably on multi-loop courses. */
  ref: string | null;
  par: number | null;
  handicap: number | null;
  tee: LatLng;
  greenCentre: LatLng;
  /** Nearest edge of the green along the approach line, not along the line to the player. */
  greenFront: LatLng;
  greenBack: LatLng;
  greenPolygon: LatLng[] | null;
  /** Always oriented tee to green, whichever way OSM digitised it. */
  centreline: LatLng[];
  lengthM: number;
}

export interface CourseGeometry {
  id: string;
  name: string;
  centre: LatLng;
  holes: OsmHoleGeometry[];
  hazards: CourseHazard[];
  source: "osm" | "manual";
  attribution: string;
  fetchedAt: string;
}

/** Scorecard hole number to `OsmHoleGeometry.osmId`. */
export type HoleMap = Record<number, string>;

export interface CourseGeometryBundle {
  courseKey: string;
  geometry: CourseGeometry;
  holeMap: HoleMap;
  matchedBy: "gps" | "manual";
}

/** A geometry entry once it is known which scorecard hole it belongs to. */
export interface PlayingHoleGeometry extends OsmHoleGeometry {
  number: number;
}

export const OSM_ATTRIBUTION = "© OpenStreetMap contributors";

export function playingHole(bundle: CourseGeometryBundle, holeNumber: number): PlayingHoleGeometry | null {
  const osmId = bundle.holeMap[holeNumber];
  if (!osmId) return null;
  const geometry = bundle.geometry.holes.find((hole) => hole.osmId === osmId);
  return geometry ? { ...geometry, number: holeNumber } : null;
}

export function playingHoles(bundle: CourseGeometryBundle): PlayingHoleGeometry[] {
  return Object.keys(bundle.holeMap)
    .map((key) => playingHole(bundle, Number(key)))
    .filter((hole): hole is PlayingHoleGeometry => hole !== null)
    .sort((left, right) => left.number - right.number);
}
