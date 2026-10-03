"use client";

import { useSyncExternalStore } from "react";
import type { Bag } from "@/lib/bag";
import { DEFAULT_BAG } from "@/lib/bag";
import { readBag, readBagSyncStatus, subscribeToBag, type BagSyncStatus } from "@/lib/bag-store";

/** This golfer's club distances, falling back to the shipped defaults. */
export function useBag(golferId: string | null): Bag {
  return useSyncExternalStore(
    subscribeToBag,
    () => readBag(golferId),
    () => DEFAULT_BAG,
  );
}

/** Whether this device's bag has reached the golfer's account yet. */
export function useBagSyncStatus(golferId: string | null): BagSyncStatus {
  return useSyncExternalStore(
    subscribeToBag,
    () => readBagSyncStatus(golferId),
    () => "idle",
  );
}
