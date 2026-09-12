"use client";

import { useEffect, useState } from "react";
import { watchFix, type GeoStatus } from "@/lib/geolocation";

const IDLE: GeoStatus = { state: "idle" };

/**
 * Live position while `enabled` is true, and nothing at all while it is false.
 *
 * Component state rather than a shared store on purpose: the watch has to die with the
 * component. A GPS watch left running for four hours is a battery bill nobody agreed to.
 */
export function usePlayerPosition(enabled: boolean): GeoStatus {
  const [status, setStatus] = useState<GeoStatus>(IDLE);

  useEffect(() => {
    if (!enabled) return;
    return watchFix(setStatus);
  }, [enabled]);

  // Read through rather than storing an idle state, so switching off does not schedule a
  // render from inside an effect.
  return enabled ? status : IDLE;
}
