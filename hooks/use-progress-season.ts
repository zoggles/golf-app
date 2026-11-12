"use client";

import { useSyncExternalStore } from "react";

/**
 * The season picked on Progress, kept for the rest of the visit so opening a round and
 * coming back lands on the same year. It lives in session storage on purpose: the next
 * time the app opens, Progress starts on the season under way.
 */

const KEY = "caddy-stack:progress-season";
const CHANGE_EVENT = "caddy-stack:progress-season-change";

// Held in memory too, so the switch still works where storage is blocked.
let picked: string | null = null;

function readSavedSeason(): string | null {
  try {
    return window.sessionStorage.getItem(KEY) ?? picked;
  } catch {
    return picked;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

export function saveSeason(season: string): void {
  picked = season;
  try {
    window.sessionStorage.setItem(KEY, season);
  } catch {
    // Blocked storage only means the pick is forgotten on the next page.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useSavedSeason(): string | null {
  return useSyncExternalStore(subscribe, readSavedSeason, () => null);
}
