"use client";

import type { LatLng } from "./hole-geometry";

/**
 * Caddy View settings, kept on the device rather than per golfer: whether GPS is welcome
 * is a property of the phone in your hand, not of whose scorecard is open.
 */

const KEY = "caddy-stack:caddy-view:v1";
const CHANGE_EVENT = "caddy-stack:caddy-view-change";

export interface CaddyViewPrefs {
  /** Off by default. The feature asks for location, so it is opted into, never assumed. */
  enabled: boolean;
  /** Whether to offer a hole switch when GPS thinks you have moved on. */
  autoHoleHint: boolean;
  /** Development only: a fixed position, so the whole flow can be driven from a desk. */
  devFix: LatLng | null;
}

// A module constant, not a fresh literal. useSyncExternalStore compares snapshots by
// identity, and a new object each call spins forever.
export const DEFAULT_PREFS: CaddyViewPrefs = { enabled: false, autoHoleHint: true, devFix: null };

let current: CaddyViewPrefs = DEFAULT_PREFS;
let restored = false;

function isLatLng(value: unknown): value is LatLng {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LatLng>;
  return typeof candidate.lat === "number" && typeof candidate.lng === "number";
}

function restore(): void {
  if (restored || typeof window === "undefined") return;
  restored = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return;
    const candidate = parsed as Partial<CaddyViewPrefs>;
    current = {
      enabled: candidate.enabled === true,
      autoHoleHint: candidate.autoHoleHint !== false,
      devFix: isLatLng(candidate.devFix) ? candidate.devFix : null,
    };
  } catch {
    current = DEFAULT_PREFS;
  }
}

export function readCaddyViewPrefs(): CaddyViewPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  restore();
  return current;
}

export function setCaddyViewPrefs(patch: Partial<CaddyViewPrefs>): void {
  restored = true;
  current = { ...readCaddyViewPrefs(), ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // A blocked storage quota must not stop the golfer from playing.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function setCaddyViewEnabled(enabled: boolean): void {
  setCaddyViewPrefs({ enabled });
}

export function subscribeToCaddyViewPrefs(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== KEY) return;
    restored = false;
    restore();
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
