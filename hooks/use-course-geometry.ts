"use client";

import { useSyncExternalStore } from "react";
import {
  readGeometryState,
  subscribeToGeometry,
  type GeometryState,
} from "@/lib/course-geometry-cache";

const EMPTY: GeometryState = { bundle: null, status: "idle", error: null };

/** Cached hole geometry for a course. Fetching is kicked off by `ensureCourseGeometry`. */
export function useCourseGeometry(courseKey: string | null): GeometryState {
  return useSyncExternalStore(
    subscribeToGeometry,
    () => readGeometryState(courseKey),
    () => EMPTY,
  );
}
