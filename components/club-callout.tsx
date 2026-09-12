"use client";

import type { Hole } from "@/lib/types";

/**
 * The static club tip that has always sat on the hole card.
 *
 * Extracted so Caddy View can keep it underneath every degraded state. Whatever goes wrong
 * with GPS, the golfer is never left with less than they had before the feature existed.
 */
export function ClubCallout({ hole }: { hole: Hole }) {
  return (
    <div className="club-callout">
      <div>
        <small>SUGGESTED OFF THE TEE</small>
        <strong>{hole.suggestedClub}</strong>
      </div>
      <p>{hole.strategy}</p>
    </div>
  );
}
