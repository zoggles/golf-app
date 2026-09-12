"use client";

import { useSyncExternalStore } from "react";
import type { Bag } from "@/lib/bag";
import { DEFAULT_BAG } from "@/lib/bag";
import { readBag, subscribeToBag } from "@/lib/bag-store";

/** This golfer's club distances, falling back to the shipped defaults. */
export function useBag(golferId: string | null): Bag {
  return useSyncExternalStore(
    subscribeToBag,
    () => readBag(golferId),
    () => DEFAULT_BAG,
  );
}
