"use client";

import { useSyncExternalStore } from "react";
import { EMPTY_ROSTER, readRoster, subscribeToRoster, type RosterState } from "@/lib/golfer-session";

/** Every golfer that can be switched to. Subscribing loads the list. */
export function useGolferRoster(): RosterState {
  return useSyncExternalStore(subscribeToRoster, readRoster, () => EMPTY_ROSTER);
}
