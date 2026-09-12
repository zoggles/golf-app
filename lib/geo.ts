import type { LatLng } from "./hole-geometry";

/** Geodesy for hole-scale distances. Pure, no browser or network dependency. */

export const EARTH_RADIUS_M = 6_371_008.8;
const METRES_PER_YARD = 0.9144;

export function metresToYards(metres: number): number {
  return metres / METRES_PER_YARD;
}

export function yardsToMetres(yards: number): number {
  return yards * METRES_PER_YARD;
}

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

export function haversineM(from: LatLng, to: LatLng): number {
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const deltaLat = lat2 - lat1;
  const deltaLng = toRadians(to.lng - from.lng);
  const a =
    Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing from one point to another, 0 to 360 clockwise from true north. */
export function bearingDeg(from: LatLng, to: LatLng): number {
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const deltaLng = toRadians(to.lng - from.lng);
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return normalizeDeg(toDegrees(Math.atan2(y, x)));
}

export function destination(from: LatLng, bearing: number, distanceM: number): LatLng {
  const angular = distanceM / EARTH_RADIUS_M;
  const lat1 = toRadians(from.lat);
  const theta = toRadians(bearing);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(theta),
  );
  const lng2 =
    toRadians(from.lng) +
    Math.atan2(
      Math.sin(theta) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: toDegrees(lat2), lng: ((toDegrees(lng2) + 540) % 360) - 180 };
}

export function normalizeDeg(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/** Signed smallest turn from one bearing to another, -180 to 180. */
export function angleDeltaDeg(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

export interface XY {
  /** Metres east of the projection origin. */
  x: number;
  /** Metres north of the projection origin. */
  y: number;
}

export interface Projection {
  origin: LatLng;
  toXY(point: LatLng): XY;
  toLatLng(point: XY): LatLng;
}

/**
 * Equirectangular projection about a local origin. Error stays well under a tenth of a
 * metre across a single golf hole, an order of magnitude finer than GPS. Build a fresh one
 * per course; it is not valid far from its origin.
 */
export function localProjection(origin: LatLng): Projection {
  const metresPerDegreeLat = (Math.PI / 180) * EARTH_RADIUS_M;
  const metresPerDegreeLng = metresPerDegreeLat * Math.cos(toRadians(origin.lat));
  return {
    origin,
    toXY: (point) => ({
      x: (point.lng - origin.lng) * metresPerDegreeLng,
      y: (point.lat - origin.lat) * metresPerDegreeLat,
    }),
    toLatLng: (point) => ({
      lat: origin.lat + point.y / metresPerDegreeLat,
      lng: origin.lng + point.x / metresPerDegreeLng,
    }),
  };
}

function meanPoint(points: LatLng[]): LatLng {
  const total = points.reduce(
    (sum, point) => ({ lat: sum.lat + point.lat, lng: sum.lng + point.lng }),
    { lat: 0, lng: 0 },
  );
  return { lat: total.lat / points.length, lng: total.lng / points.length };
}

/** Area-weighted centroid, falling back to the mean for degenerate rings. */
export function polygonCentroid(points: LatLng[]): LatLng {
  if (points.length === 0) throw new Error("polygonCentroid needs at least one point.");
  if (points.length < 3) return meanPoint(points);

  const projection = localProjection(points[0]);
  const ring = points.map(projection.toXY);
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    const cross = current.x * next.y - next.x * current.y;
    twiceArea += cross;
    x += (current.x + next.x) * cross;
    y += (current.y + next.y) * cross;
  }
  if (Math.abs(twiceArea) < 1e-9) return meanPoint(points);
  return projection.toLatLng({ x: x / (3 * twiceArea), y: y / (3 * twiceArea) });
}

/** Largest distance from the centroid to any vertex. */
export function polygonRadiusM(points: LatLng[], centre?: LatLng): number {
  if (points.length === 0) return 0;
  const origin = centre ?? polygonCentroid(points);
  return points.reduce((widest, point) => Math.max(widest, haversineM(origin, point)), 0);
}

export function pathLengthM(points: LatLng[]): number {
  let total = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    total += haversineM(points[index], points[index + 1]);
  }
  return total;
}

/** Walks the path, clamping at both ends rather than extrapolating. */
export function pointAlongPath(points: LatLng[], distanceM: number): LatLng {
  if (points.length === 0) throw new Error("pointAlongPath needs at least one point.");
  if (points.length === 1 || distanceM <= 0) return points[0];

  let travelled = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const segment = haversineM(points[index], points[index + 1]);
    if (travelled + segment >= distanceM) {
      const remaining = distanceM - travelled;
      if (segment < 1e-6) return points[index];
      return destination(points[index], bearingDeg(points[index], points[index + 1]), remaining);
    }
    travelled += segment;
  }
  return points[points.length - 1];
}

export function nearestPointOnSegment(
  start: LatLng,
  end: LatLng,
  point: LatLng,
): { point: LatLng; t: number } {
  const projection = localProjection(start);
  const a = projection.toXY(start);
  const b = projection.toXY(end);
  const p = projection.toXY(point);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-9) return { point: start, t: 0 };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return { point: projection.toLatLng({ x: a.x + t * dx, y: a.y + t * dy }), t };
}

export interface NearestOnPath {
  point: LatLng;
  /** How far the point sits off the path, which is how far into the trees you are. */
  distanceM: number;
  /** How far along the path the nearest point lies, measured from the start. */
  alongM: number;
}

export function nearestPointOnPath(points: LatLng[], point: LatLng): NearestOnPath {
  if (points.length === 0) throw new Error("nearestPointOnPath needs at least one point.");
  if (points.length === 1) {
    return { point: points[0], distanceM: haversineM(points[0], point), alongM: 0 };
  }

  let best: NearestOnPath = { point: points[0], distanceM: Infinity, alongM: 0 };
  let travelled = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const segmentLength = haversineM(points[index], points[index + 1]);
    const candidate = nearestPointOnSegment(points[index], points[index + 1], point);
    const distanceM = haversineM(candidate.point, point);
    if (distanceM < best.distanceM) {
      best = { point: candidate.point, distanceM, alongM: travelled + candidate.t * segmentLength };
    }
    travelled += segmentLength;
  }
  return best;
}

export function pointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1
  ) {
    const a = polygon[index];
    const b = polygon[previous];
    const straddles = a.lat > point.lat !== b.lat > point.lat;
    if (!straddles) continue;
    const crossingLng = ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng;
    if (point.lng < crossingLng) inside = !inside;
  }
  return inside;
}

function douglasPeucker(points: LatLng[], toleranceM: number): LatLng[] {
  if (points.length <= 2) return points;

  let furthestIndex = 0;
  let furthestDistance = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const { point } = nearestPointOnSegment(points[0], points[points.length - 1], points[index]);
    const distance = haversineM(point, points[index]);
    if (distance > furthestDistance) {
      furthestDistance = distance;
      furthestIndex = index;
    }
  }
  if (furthestDistance <= toleranceM) return [points[0], points[points.length - 1]];

  const left = douglasPeucker(points.slice(0, furthestIndex + 1), toleranceM);
  const right = douglasPeucker(points.slice(furthestIndex), toleranceM);
  return [...left.slice(0, -1), ...right];
}

/**
 * Ramer-Douglas-Peucker, then a hard cap. Endpoints always survive, so an oriented
 * centreline keeps both its tee and its green.
 */
export function simplifyPath(points: LatLng[], maxPoints: number, toleranceM = 1): LatLng[] {
  if (points.length <= 2 || points.length <= maxPoints) return points;

  let simplified = douglasPeucker(points, toleranceM);
  let tolerance = toleranceM;
  while (simplified.length > maxPoints && tolerance < 10_000) {
    tolerance *= 2;
    simplified = douglasPeucker(points, tolerance);
  }
  if (simplified.length <= maxPoints) return simplified;

  // A ring that resists simplification: keep an even sample, both ends included.
  const step = (simplified.length - 1) / (maxPoints - 1);
  const sampled: LatLng[] = [];
  for (let index = 0; index < maxPoints; index += 1) {
    sampled.push(simplified[Math.round(index * step)]);
  }
  return sampled;
}
