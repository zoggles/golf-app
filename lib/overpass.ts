import "server-only";

/**
 * Read-only client for the Overpass API, which serves OpenStreetMap data.
 *
 * Free and keyless, but a shared community resource, so this is called at most once per
 * physical course. Everything after that is served from public.course_geometry.
 */

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
] as const;

// Overpass asks clients to identify themselves, and anonymous traffic is throttled harder.
const USER_AGENT = "CaddyStack/1.0 (+https://caddy-stack.vercel.app)";
const REQUEST_TIMEOUT_MS = 25_000;

export interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
  center?: { lat: number; lon: number };
}

export class OverpassUnavailableError extends Error {
  constructor(message = "Course map data is unavailable right now.") {
    super(message);
    this.name = "OverpassUnavailableError";
  }
}

/**
 * One query for both the course identity and its features. The course radius is wider than
 * the feature radius so a fix taken from a far corner still finds the clubhouse polygon.
 */
export function courseAndHolesQuery(lat: number, lng: number): string {
  const fix = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  return [
    "[out:json][timeout:90];",
    `nwr["leisure"="golf_course"](around:2500,${fix})->.course;`,
    // geom as well as center: the polygon is what separates this course's holes from a
    // neighbour's when the two sit inside the same radius.
    ".course out tags geom center;",
    `way["golf"](around:1400,${fix})->.features;`,
    ".features out tags geom;",
  ].join("\n");
}

async function requestMirror(endpoint: string, query: string): Promise<OverpassElement[]> {
  const response = await fetch(endpoint, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
    // Form-encoded rather than a query string: these bodies outgrow URL length limits.
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new OverpassUnavailableError(`Overpass mirror returned ${response.status}.`);
  }

  const payload = (await response.json()) as { elements?: OverpassElement[] };
  if (!Array.isArray(payload.elements)) {
    throw new OverpassUnavailableError("Overpass returned an unexpected payload.");
  }
  return payload.elements;
}

/** Tries each mirror in turn. Throws OverpassUnavailableError only when all of them fail. */
export async function runOverpass(query: string): Promise<OverpassElement[]> {
  let lastFailure: unknown = null;
  for (const endpoint of MIRRORS) {
    try {
      return await requestMirror(endpoint, query);
    } catch (cause) {
      lastFailure = cause;
    }
  }
  throw new OverpassUnavailableError(
    lastFailure instanceof Error
      ? `Every Overpass mirror failed. Last error: ${lastFailure.message}`
      : "Every Overpass mirror failed.",
  );
}
