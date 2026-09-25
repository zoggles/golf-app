"use client";

import { useEffect, useState } from "react";
import { watchCompass } from "@/lib/compass";

/**
 * The phone's compass heading, or null until it gives one. Like the position watch, the
 * listener dies with the component, so the sensor only runs while something is pointing.
 */
export function useCompassHeading(): number | null {
  const [heading, setHeading] = useState<number | null>(null);
  useEffect(() => watchCompass(setHeading), []);
  return heading;
}
