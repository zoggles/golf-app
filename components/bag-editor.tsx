"use client";

import { ArrowCounterClockwise, Minus, Plus } from "@phosphor-icons/react";
import type { Bag } from "@/lib/bag";
import { MAX_CARRY_YDS, MIN_CARRY_YDS } from "@/lib/bag";
import { resetBag, saveBag } from "@/lib/bag-store";

/**
 * Carry distances, edited in place.
 *
 * Lives inside the Caddy View card rather than behind a settings screen, because the moment
 * you notice a number is wrong is the moment the club recommendation looks wrong, and that
 * is here.
 */

const STEP_YDS = 5;

export function BagEditor({ bag, golferId }: { bag: Bag; golferId: string | null }) {
  if (!golferId) return null;

  function adjust(clubId: string, delta: number) {
    saveBag(golferId!, {
      clubs: bag.clubs.map((club) =>
        club.id === clubId
          ? {
              ...club,
              carryYds: Math.min(MAX_CARRY_YDS, Math.max(MIN_CARRY_YDS, club.carryYds + delta)),
            }
          : club,
      ),
    });
  }

  return (
    <details className="optional-stats caddy-bag">
      <summary>
        <span>My clubs</span>
        <small>Carry distances</small>
      </summary>
      <div className="optional-stats-grid">
        <p className="caddy-bag-note">
          Caddy View picks from these. Set them to the distance you actually carry the ball,
          not your best ever.
        </p>
        {bag.clubs.map((club) => (
          <div className="optional-stat-row" key={club.id}>
            <span>
              <strong>{club.label}</strong>
              <small>{club.carryYds} yards</small>
            </span>
            <div className="metric-counter">
              <button
                type="button"
                onClick={() => adjust(club.id, -STEP_YDS)}
                disabled={club.carryYds <= MIN_CARRY_YDS}
                aria-label={`Decrease ${club.label} carry`}
              >
                <Minus size={15} />
              </button>
              <strong>{club.carryYds}</strong>
              <button
                type="button"
                onClick={() => adjust(club.id, STEP_YDS)}
                disabled={club.carryYds >= MAX_CARRY_YDS}
                aria-label={`Increase ${club.label} carry`}
              >
                <Plus size={15} />
              </button>
            </div>
          </div>
        ))}
        <div className="optional-stat-row">
          <span>
            <strong>Start over</strong>
            <small>Back to the default distances</small>
          </span>
          <button type="button" className="metric-toggle" onClick={() => resetBag(golferId!)}>
            <ArrowCounterClockwise size={14} /> Reset
          </button>
        </div>
      </div>
    </details>
  );
}
