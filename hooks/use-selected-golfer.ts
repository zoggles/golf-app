"use client";

import { useSyncExternalStore } from "react";
import { readSelectedGolfer, subscribeToSelectedGolfer } from "@/lib/golfer-session";
import type { Golfer } from "@/lib/golfers";

/**
 * The selected golfer, or `null` when nobody is. It reads `undefined` until the
 * browser store has been consulted, which the server render cannot do, so a
 * caller can hold the frame instead of guessing.
 */
export function useSelectedGolfer(): Golfer | null | undefined {
  return useSyncExternalStore(subscribeToSelectedGolfer, readSelectedGolfer, () => undefined);
}
