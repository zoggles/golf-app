"use client";

import { useSyncExternalStore } from "react";
import { EMPTY_GOLF_DATA, readGolfData, subscribeToGolfData } from "@/lib/storage";

export function useGolfData() {
  return useSyncExternalStore(subscribeToGolfData, readGolfData, () => EMPTY_GOLF_DATA);
}
