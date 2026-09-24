"use client";

import { apiUrl } from "./api-url";
import { authHeaders } from "./auth-client";
import type { CourseGeometryBundle, LatLng } from "./hole-geometry";
import type { ScorecardHole } from "./osm-normalize";

/**
 * Offline mirror of course geometry.
 *
 * Not scoped by golfer: a green is in the same place for everyone, so this follows the
 * shared-catalogue treatment courses already get. A complete copy never expires either — a
 * golf hole does not move. Two kinds of copy are checked again: one with gaps, because the
 * server may since have learned the holes it was missing, and one saved before water and trees
 * were read, which has every hole but none of what lies beside them.
 *
 * This is what lets the map work in a dead zone. GPS itself needs no network, so once the
 * course is cached the whole feature runs offline.
 */

const KEY_PREFIX = "caddy-stack:geometry:v1:";
/** How long to wait before retrying a course whose lookup failed. */
const RETRY_AFTER_MS = 10 * 60 * 1000;

export type GeometryStatus = "idle" | "loading" | "ready" | "unmapped" | "error";

export interface GeometryState {
  bundle: CourseGeometryBundle | null;
  status: GeometryStatus;
  error: string | null;
}

const EMPTY_STATE: GeometryState = { bundle: null, status: "idle", error: null };

const listeners = new Set<() => void>();
const states = new Map<string, GeometryState>();
const inFlight = new Set<string>();
const lastFailureAt = new Map<string, number>();
/** Courses whose copy with gaps has had its second look this session. */
const rechecked = new Set<string>();
/** Courses already downloaded ahead of play this session. */
const refreshed = new Set<string>();

function publish(courseKey: string, state: GeometryState): void {
  states.set(courseKey, state);
  listeners.forEach((listener) => listener());
}

function storageKey(courseKey: string): string {
  return `${KEY_PREFIX}${courseKey}`;
}

function restore(courseKey: string): CourseGeometryBundle | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(courseKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CourseGeometryBundle;
    return parsed?.geometry?.holes ? parsed : null;
  } catch {
    return null;
  }
}

function persist(bundle: CourseGeometryBundle): void {
  try {
    window.localStorage.setItem(storageKey(bundle.courseKey), JSON.stringify(bundle));
  } catch {
    // A full quota costs the offline copy, not the round.
  }
}

/** Scorecard holes this copy can actually draw: mapped to a hole that is really in it. */
export function mappedHoleCount(bundle: CourseGeometryBundle | null): number {
  if (!bundle) return 0;
  const present = new Set(bundle.geometry.holes.map((hole) => hole.osmId));
  return Object.values(bundle.holeMap).filter((osmId) => present.has(osmId)).length;
}

/** Saved before obstacles were read: it can draw the holes, but not the water and trees beside them. */
export function predatesObstacles(bundle: CourseGeometryBundle | null): boolean {
  return bundle !== null && bundle.geometry.trees === undefined;
}

/**
 * Whether a copy from the server is better than the one on the phone. More holes always wins
 * and fewer never does; with the same holes, a copy that knows the obstacles beats one that
 * does not.
 */
function improvesOn(incoming: CourseGeometryBundle, existing: CourseGeometryBundle | null): boolean {
  if (!existing) return true;
  const gained = mappedHoleCount(incoming) - mappedHoleCount(existing);
  if (gained !== 0) return gained > 0;
  return predatesObstacles(existing) && !predatesObstacles(incoming);
}

function statusFor(bundle: CourseGeometryBundle): GeometryStatus {
  return bundle.geometry.holes.length > 0 ? "ready" : "unmapped";
}

function adopt(bundle: CourseGeometryBundle): void {
  persist(bundle);
  publish(bundle.courseKey, { bundle, status: statusFor(bundle), error: null });
}

export function readGeometryState(courseKey: string | null): GeometryState {
  if (!courseKey) return EMPTY_STATE;

  const known = states.get(courseKey);
  if (known) return known;

  const cached = restore(courseKey);
  const state: GeometryState = cached
    ? { bundle: cached, status: statusFor(cached), error: null }
    : EMPTY_STATE;
  states.set(courseKey, state);
  return state;
}

export function subscribeToGeometry(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  listeners.add(onChange);
  return () => void listeners.delete(onChange);
}

export interface EnsureGeometryInput {
  courseKey: string;
  holes: ScorecardHole[];
  fix: LatLng;
}

/**
 * Resolves geometry for a course. Serves the cache when it can, and otherwise asks the
 * server, which is the only place that ever talks to OpenStreetMap.
 *
 * A copy with every hole is final. A copy with gaps, such as the empty answer saved when the
 * course was first looked up from somewhere other than the course, gets one more look a
 * session, and is only ever replaced by one that knows at least as many holes.
 */
export async function ensureCourseGeometry(input: EnsureGeometryInput): Promise<void> {
  const { courseKey } = input;
  const existing = readGeometryState(courseKey);
  if (inFlight.has(courseKey)) return;

  const incomplete = existing.bundle !== null && mappedHoleCount(existing.bundle) < input.holes.length;
  const needsLook = incomplete || predatesObstacles(existing.bundle);
  if (existing.bundle && (!needsLook || rechecked.has(courseKey))) return;

  const failedAt = lastFailureAt.get(courseKey);
  if (failedAt && Date.now() - failedAt < RETRY_AFTER_MS) return;

  if (needsLook) rechecked.add(courseKey);
  inFlight.add(courseKey);
  if (!existing.bundle) publish(courseKey, { bundle: null, status: "loading", error: null });

  try {
    const response = await fetch(apiUrl("/api/course-geometry"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        courseKey,
        // Rounded to about a hundred metres: enough to say which course you are on, and
        // no more precise than that. After this the course is cached and no position is
        // ever sent again.
        fix: { lat: Number(input.fix.lat.toFixed(3)), lng: Number(input.fix.lng.toFixed(3)) },
        holes: input.holes,
      }),
    });
    const result = (await response.json()) as { bundle?: CourseGeometryBundle | null; error?: string };
    if (!response.ok) throw new Error(result.error || "Could not load the hole map.");
    if (!result.bundle) throw new Error("No hole map for this course yet.");
    if (!existing.bundle || mappedHoleCount(result.bundle) >= mappedHoleCount(existing.bundle)) {
      adopt(result.bundle);
    }
  } catch (cause) {
    lastFailureAt.set(courseKey, Date.now());
    // A failed second look keeps the copy already on the phone.
    if (!existing.bundle) {
      publish(courseKey, {
        bundle: null,
        status: "error",
        error: cause instanceof Error ? cause.message : "Could not load the hole map.",
      });
    }
  } finally {
    inFlight.delete(courseKey);
  }
}

/**
 * Downloads a course's hole map ahead of play.
 *
 * Needs no position, because it only reads what the server already holds, so it runs the
 * moment a round opens: at home on Wi-Fi, before the first tee and any dead zone. A copy with
 * every hole and its obstacles is left alone, and nothing replaces a copy with one that knows
 * fewer holes.
 */
export async function refreshCourseGeometry(courseKey: string, holeCount: number): Promise<void> {
  if (typeof window === "undefined" || refreshed.has(courseKey) || inFlight.has(courseKey)) return;
  const existing = readGeometryState(courseKey);
  if (existing.bundle && mappedHoleCount(existing.bundle) >= holeCount && !predatesObstacles(existing.bundle)) return;

  try {
    const response = await fetch(apiUrl(`/api/course-geometry?courseKey=${encodeURIComponent(courseKey)}`), {
      cache: "no-store",
      headers: authHeaders(),
    });
    if (!response.ok) return;
    refreshed.add(courseKey);
    const result = (await response.json()) as { bundle?: CourseGeometryBundle | null };
    if (result.bundle && improvesOn(result.bundle, existing.bundle)) {
      lastFailureAt.delete(courseKey);
      adopt(result.bundle);
    }
  } catch {
    // Offline or signed out: keep whatever copy there is. Caddy View resolves it at the course.
  }
}

/** Saves a green captured by standing on it, for a hole nobody has mapped. */
export async function captureGreen(input: {
  courseKey: string;
  holeNumber: number;
  green: LatLng;
  tee?: LatLng;
}): Promise<void> {
  const response = await fetch(apiUrl("/api/course-geometry"), {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(input),
  });
  const result = (await response.json()) as { bundle?: CourseGeometryBundle | null; error?: string };
  if (!response.ok || !result.bundle) throw new Error(result.error || "Could not save that green.");
  lastFailureAt.delete(input.courseKey);
  adopt(result.bundle);
}
