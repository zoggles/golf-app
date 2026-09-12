"use client";

import { useSyncExternalStore } from "react";
import {
  DEFAULT_PREFS,
  readCaddyViewPrefs,
  subscribeToCaddyViewPrefs,
  type CaddyViewPrefs,
} from "@/lib/caddy-view-prefs";

/** Caddy View settings for this device. Reads as off until the browser store is consulted. */
export function useCaddyViewPrefs(): CaddyViewPrefs {
  return useSyncExternalStore(subscribeToCaddyViewPrefs, readCaddyViewPrefs, () => DEFAULT_PREFS);
}
