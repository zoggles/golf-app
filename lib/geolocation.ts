"use client";

import { readCaddyViewPrefs } from "./caddy-view-prefs";

/**
 * One position watch for both the website and the Android app.
 *
 * Capacitor's bridge enables geolocation on the WebView and answers the runtime permission
 * prompt itself, so plain `navigator.geolocation` is the whole implementation on both
 * platforms. The manifest still has to declare the location permissions.
 */

export interface Fix {
  lat: number;
  lng: number;
  /** Reported accuracy in metres. Drives both the halo and how wide the shot is drawn. */
  accuracyM: number;
  headingDeg: number | null;
  at: number;
}

export type GeoStatus =
  | { state: "idle" }
  | { state: "locating" }
  | { state: "tracking"; fix: Fix }
  | { state: "denied" }
  | { state: "unsupported" }
  | { state: "error"; message: string; lastFix: Fix | null };

/** Ignore fixes arriving faster than this; the map has nothing new to say. */
const MIN_INTERVAL_MS = 750;
/** A fix this vague is not worth replacing a recent good one with. */
const POOR_ACCURACY_M = 100;
const RECENT_FIX_MS = 20_000;
const DEV_FIX_INTERVAL_MS = 1000;

export function watchFix(onChange: (status: GeoStatus) => void): () => void {
  if (typeof window === "undefined") return () => undefined;

  // A fixed position for development, so every state can be exercised from a desk without
  // DevTools. Never reachable in a production build.
  const devFix = process.env.NODE_ENV === "production" ? null : readCaddyViewPrefs().devFix;
  if (devFix) {
    const emit = () =>
      onChange({
        state: "tracking",
        fix: { lat: devFix.lat, lng: devFix.lng, accuracyM: 4, headingDeg: null, at: Date.now() },
      });
    emit();
    const timer = window.setInterval(emit, DEV_FIX_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }

  if (!navigator?.geolocation) {
    onChange({ state: "unsupported" });
    return () => undefined;
  }

  let lastFix: Fix | null = null;
  let lastEmitAt = 0;
  let cancelled = false;

  onChange({ state: "locating" });

  const watchId = navigator.geolocation.watchPosition(
    (position) => {
      if (cancelled) return;
      const now = Date.now();
      if (now - lastEmitAt < MIN_INTERVAL_MS) return;

      const accuracyM = position.coords.accuracy ?? Number.POSITIVE_INFINITY;
      const haveRecentBetter =
        lastFix !== null && now - lastFix.at < RECENT_FIX_MS && lastFix.accuracyM < accuracyM;
      if (accuracyM > POOR_ACCURACY_M && haveRecentBetter) return;

      lastEmitAt = now;
      lastFix = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracyM,
        headingDeg: Number.isFinite(position.coords.heading) ? position.coords.heading : null,
        at: now,
      };
      onChange({ state: "tracking", fix: lastFix });
    },
    (error) => {
      if (cancelled) return;
      if (error.code === error.PERMISSION_DENIED) {
        onChange({ state: "denied" });
        return;
      }
      // Tree cover drops the signal constantly. A momentary failure must not blank a map
      // that was working a second ago, so a known position survives the gap.
      if (lastFix) {
        onChange({ state: "tracking", fix: lastFix });
        return;
      }
      onChange({
        state: "error",
        message:
          error.code === error.TIMEOUT
            ? "Still looking for a signal."
            : "Your location is unavailable right now.",
        lastFix: null,
      });
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 20_000 },
  );

  return () => {
    cancelled = true;
    navigator.geolocation.clearWatch(watchId);
  };
}
