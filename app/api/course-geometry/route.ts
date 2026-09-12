import { persistenceErrorResponse } from "@/lib/api-errors";
import { resolveAuthenticatedGolferId } from "@/lib/auth-server";
import { bearingDeg, destination, haversineM } from "@/lib/geo";
import { parseGeometryPin, parseGeometryResolve } from "@/lib/geometry-payloads";
import type { CourseGeometry, CourseGeometryBundle, HoleMap, LatLng } from "@/lib/hole-geometry";
import { OSM_ATTRIBUTION } from "@/lib/hole-geometry";
import { assignHoles, normalizeOsmCourse, type ScorecardHole } from "@/lib/osm-normalize";
import { courseAndHolesQuery, OverpassUnavailableError, runOverpass } from "@/lib/overpass";
import {
  findNearbyCourseGeometry,
  readCourseGeometryBundle,
  readCourseGeometryRow,
  saveCourseGeometryLink,
  saveCourseGeometryRow,
} from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
// Overpass is a shared community service and can take tens of seconds under load.
export const maxDuration = 120;

/** A cached course this far from the fix is the one you are standing on. */
const NEARBY_COURSE_RADIUS_M = 2500;
/** Half the depth of a typical green, for a hole captured by hand rather than mapped. */
const ASSUMED_GREEN_HALF_DEPTH_M = 9;

/**
 * Dedupes concurrent first-fetches of the same course within one warm instance. The real
 * protection against hammering Overpass is the two cache lookups that run before it.
 */
const inFlight = new Map<string, Promise<CourseGeometryBundle>>();

function bundleResponse(bundle: CourseGeometryBundle | null) {
  return Response.json({ bundle });
}

/** Reads the cache only. The hot path for every round after a course's first. */
export async function GET(request: Request) {
  try {
    await resolveAuthenticatedGolferId(request);
    const courseKey = new URL(request.url).searchParams.get("courseKey");
    if (!courseKey) return Response.json({ error: "A courseKey is required." }, { status: 400 });
    return bundleResponse(await readCourseGeometryBundle(courseKey));
  } catch (cause) {
    return persistenceErrorResponse(cause);
  }
}

/** Reuses a cached course that sits within range of the fix, whatever key it was saved under. */
async function linkToNearbyCourse(
  courseKey: string,
  fix: LatLng,
  holes: ScorecardHole[],
): Promise<CourseGeometryBundle | null> {
  const nearby = await findNearbyCourseGeometry(fix.lat, fix.lng, NEARBY_COURSE_RADIUS_M);
  if (nearby.length === 0) return null;

  const closest = nearby.reduce((best, candidate) =>
    haversineM(candidate.centre, fix) < haversineM(best.centre, fix) ? candidate : best,
  );
  if (haversineM(closest.centre, fix) > NEARBY_COURSE_RADIUS_M) return null;

  const geometry = await readCourseGeometryRow(closest.id);
  if (!geometry) return null;

  const holeMap = assignHoles(geometry.holes, holes);
  await saveCourseGeometryLink({ courseKey, geometryId: geometry.id, holeMap, matchedBy: "gps" });
  return { courseKey, geometry, holeMap, matchedBy: "gps" };
}

/**
 * Records a course Overpass knows nothing about.
 *
 * Writing an empty row rather than nothing is what stops this course being looked up again
 * on every hole: the client sees no holes, offers to capture greens by hand, and the
 * captures land in this same row.
 */
function emptyGeometry(courseKey: string, fix: LatLng): CourseGeometry {
  return {
    id: `manual/${courseKey}`,
    name: "",
    centre: fix,
    holes: [],
    hazards: [],
    source: "manual",
    attribution: OSM_ATTRIBUTION,
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchAndCache(
  courseKey: string,
  fix: LatLng,
  holes: ScorecardHole[],
): Promise<CourseGeometryBundle> {
  const elements = await runOverpass(courseAndHolesQuery(fix.lat, fix.lng));
  const normalized = normalizeOsmCourse({ elements, fix, holes });

  if (normalized.geometry.holes.length === 0) {
    const geometry = await saveCourseGeometryRow(emptyGeometry(courseKey, fix));
    await saveCourseGeometryLink({ courseKey, geometryId: geometry.id, holeMap: {}, matchedBy: "manual" });
    return { courseKey, geometry, holeMap: {}, matchedBy: "manual" };
  }

  const geometry = await saveCourseGeometryRow(normalized.geometry);
  await saveCourseGeometryLink({
    courseKey,
    geometryId: geometry.id,
    holeMap: normalized.holeMap,
    matchedBy: "gps",
  });
  return { courseKey, geometry, holeMap: normalized.holeMap, matchedBy: "gps" };
}

/**
 * Resolves geometry for a course, fetching it from OpenStreetMap only when nothing cached
 * can serve. The ordering here is what keeps Overpass to roughly one call per course ever,
 * across every golfer and every set of tees.
 */
export async function POST(request: Request) {
  try {
    await resolveAuthenticatedGolferId(request);
    const { courseKey, fix, holes } = parseGeometryResolve(await request.json());

    const cached = await readCourseGeometryBundle(courseKey);
    if (cached) return bundleResponse(cached);

    const nearby = await linkToNearbyCourse(courseKey, fix, holes);
    if (nearby) return bundleResponse(nearby);

    const pending = inFlight.get(courseKey) ?? fetchAndCache(courseKey, fix, holes);
    inFlight.set(courseKey, pending);
    try {
      return bundleResponse(await pending);
    } finally {
      inFlight.delete(courseKey);
    }
  } catch (cause) {
    if (cause instanceof OverpassUnavailableError) {
      return Response.json(
        {
          error: "Course maps are busy right now. Caddy View will use the club tip until the hole loads.",
          retryable: true,
        },
        { status: 503 },
      );
    }
    return persistenceErrorResponse(cause);
  }
}

/**
 * Captures one green by hand for a hole OSM never mapped.
 *
 * Written globally rather than per golfer, matching how courses are treated: a green is in
 * the same place for everyone, so the next person to play here inherits the capture.
 */
export async function PATCH(request: Request) {
  try {
    await resolveAuthenticatedGolferId(request);
    const { courseKey, holeNumber, green, tee } = parseGeometryPin(await request.json());

    const existing = await readCourseGeometryBundle(courseKey);
    const base = existing?.geometry ?? emptyGeometry(courseKey, green);
    const osmId = `manual/${courseKey}/${holeNumber}`;
    const teePoint = tee ?? existing?.geometry.holes.find((hole) => hole.osmId === osmId)?.tee ?? green;

    // Without a mapped putting surface, front and back sit half a typical green either
    // side of the captured point, along the line of play.
    const approach = haversineM(teePoint, green) > 1 ? bearingDeg(teePoint, green) : 0;
    const captured = {
      osmId,
      ref: String(holeNumber),
      par: null,
      handicap: null,
      tee: teePoint,
      greenCentre: green,
      greenFront: destination(green, approach + 180, ASSUMED_GREEN_HALF_DEPTH_M),
      greenBack: destination(green, approach, ASSUMED_GREEN_HALF_DEPTH_M),
      greenPolygon: null,
      centreline: [teePoint, green],
      lengthM: haversineM(teePoint, green),
    };

    const geometry: CourseGeometry = {
      ...base,
      source: base.source === "osm" ? "osm" : "manual",
      holes: [...base.holes.filter((hole) => hole.osmId !== osmId), captured],
    };
    const holeMap: HoleMap = { ...(existing?.holeMap ?? {}), [holeNumber]: osmId };

    const saved = await saveCourseGeometryRow(geometry);
    await saveCourseGeometryLink({
      courseKey,
      geometryId: saved.id,
      holeMap,
      matchedBy: existing?.matchedBy ?? "manual",
    });
    return bundleResponse({ courseKey, geometry: saved, holeMap, matchedBy: existing?.matchedBy ?? "manual" });
  } catch (cause) {
    return persistenceErrorResponse(cause);
  }
}
