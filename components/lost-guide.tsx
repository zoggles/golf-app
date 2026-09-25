"use client";

import { useEffect, useMemo, useState } from "react";
import { CaretLeft, CaretRight, CheckCircle, Compass, Spinner, Warning, X } from "@phosphor-icons/react";
import { LostMap } from "@/components/lost-map";
import { useCompassHeading } from "@/hooks/use-compass-heading";
import { useCourseGeometry } from "@/hooks/use-course-geometry";
import { usePlayerPosition } from "@/hooks/use-player-position";
import { courseKey } from "@/lib/course-key";
import { metresToYards } from "@/lib/geo";
import { playingHoles, type CourseHazard, type TreeArea } from "@/lib/hole-geometry";
import {
  compassWord,
  guideToHole,
  hasArrived,
  ordinal,
  TURN_TEXT,
  turnToward,
  whereaboutsText,
} from "@/lib/lost-guide";
import { onBackPress } from "@/lib/native-back";
import type { Course } from "@/lib/types";

/**
 * "I'm lost": walks you back to the hole you should be playing.
 *
 * A full-screen layer over the round rather than another card in it, because while it is
 * open finding the tee is the only job. It runs its own position watch and compass, and both
 * stop the moment it closes. Nothing about the round changes until you say which hole to play.
 */

/** Past this the fix is too vague to quote a single number from. */
const WEAK_FIX_M = 25;
/** Android's approximate-location grant lands in the hundreds of metres. Useless here. */
const COARSE_FIX_M = 150;

const NO_HAZARDS: CourseHazard[] = [];
const NO_TREES: TreeArea[] = [];

interface LostGuideProps {
  course: Course;
  /** The round's holes, in the order they are played. */
  holeNumbers: number[];
  /** The next hole on the card, which is where the guide starts. */
  nextHole: number;
  onClose: () => void;
  onPlayHole: (holeNumber: number) => void;
}

export function LostGuide({ course, holeNumbers, nextHole, onClose, onPlayHole }: LostGuideProps) {
  const key = useMemo(() => courseKey(course), [course]);
  const geometry = useCourseGeometry(key);
  const position = usePlayerPosition(true);
  const compass = useCompassHeading();
  const [targetNumber, setTargetNumber] = useState(nextHole);
  const [arrivedAt, setArrivedAt] = useState<number | null>(null);

  // The page underneath stays put, and back or Escape close this before going anywhere else.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.lostGuide = "true";
    const releaseBack = onBackPress(onClose);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      delete root.dataset.lostGuide;
      releaseBack();
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const fix = position.state === "tracking" ? position.fix : null;
  const holes = useMemo(() => (geometry.bundle ? playingHoles(geometry.bundle) : []), [geometry.bundle]);
  const hazards = geometry.bundle?.geometry.hazards ?? NO_HAZARDS;
  const trees = geometry.bundle?.geometry.trees ?? NO_TREES;
  const target = holes.find((hole) => hole.number === targetNumber) ?? null;
  const card = course.holes.find((hole) => hole.number === targetNumber) ?? null;
  const usableFix = fix && fix.accuracyM <= COARSE_FIX_M ? fix : null;

  const guidance = useMemo(
    () =>
      usableFix && target
        ? guideToHole({ from: usableFix, hole: target, yards: card?.yards ?? 0, holes, hazards })
        : null,
    [usableFix, target, card, holes, hazards],
  );

  // Sticky once there, so a fix wobbling at the edge of the tee cannot flick the screen back.
  const wasArrived = arrivedAt === targetNumber;
  const arrived = guidance ? hasArrived(guidance.teeBoxM, wasArrived) : wasArrived;
  if (arrived !== wasArrived) setArrivedAt(arrived ? targetNumber : null);

  const index = holeNumbers.indexOf(targetNumber);
  const stepTarget = (direction: -1 | 1) => {
    const next = holeNumbers[index + direction];
    if (next !== undefined) setTargetNumber(next);
  };

  const status = (tone: "" | "warn" | "error", icon: React.ReactNode, message: string) => (
    <div className={tone ? `lost-status ${tone}` : "lost-status"} role="status">
      {icon}
      <span>{message}</span>
    </div>
  );

  let body: React.ReactNode;
  if (position.state === "unsupported") {
    body = status("warn", <Warning size={18} weight="fill" />, "This device has no GPS, so it cannot point the way.");
  } else if (position.state === "denied") {
    body = status(
      "error",
      <Warning size={18} weight="fill" />,
      "Finding your hole needs location access. Allow location for Caddy Stack, then try again.",
    );
  } else if (position.state === "error") {
    body = status("warn", <Warning size={18} weight="fill" />, position.message);
  } else if (fix && !usableFix) {
    body = status(
      "warn",
      <Warning size={18} weight="fill" />,
      "Only approximate location is being shared. Allow precise location to find your hole.",
    );
  } else if (holes.length === 0) {
    body = status(
      "warn",
      <Warning size={18} weight="fill" />,
      geometry.status === "loading" ? "Loading the course map…" : "There is no map of this course yet, so there is nothing to steer by.",
    );
  } else if (!target) {
    body = status(
      "warn",
      <Warning size={18} weight="fill" />,
      `Hole ${targetNumber} is not on the course map, so it cannot be pointed out. Pick another hole above.`,
    );
  } else if (!usableFix || !guidance) {
    body = status("", <Spinner size={18} className="spin" />, "Finding you…");
  } else {
    const heading = compass ?? usableFix.headingDeg;
    const pointing = heading === null ? null : turnToward(heading, guidance.bearingDeg);
    const band = usableFix.accuracyM > WEAK_FIX_M ? ` ±${Math.round(metresToYards(usableFix.accuracyM))}` : "";

    body = (
      <>
        {arrived ? (
          <div className="lost-arrived" role="status">
            <CheckCircle size={30} weight="fill" />
            <div>
              <strong>You made it to hole {target.number}.</strong>
              <span>This is its tee. Good luck.</span>
            </div>
          </div>
        ) : (
          <div className="lost-pointer">
            <div className="lost-arrow" aria-hidden="true">
              {pointing ? (
                <svg viewBox="0 0 100 100" style={{ transform: `rotate(${pointing.relativeDeg.toFixed(1)}deg)` }}>
                  <path d="M50 6 L84 90 L50 70 L16 90 Z" />
                </svg>
              ) : (
                <Compass size={46} weight="duotone" />
              )}
            </div>
            <div className="lost-pointer-copy">
              <small>TO THE HOLE {target.number} TEE</small>
              <strong>
                {Math.round(guidance.distanceYds)}
                {band} <span>yd</span>
              </strong>
              <p>{pointing ? TURN_TEXT[pointing.turn] : `Head ${compassWord(guidance.bearingDeg)}`}</p>
            </div>
          </div>
        )}

        {arrived ? null : (
          <ul className="lost-notes">
            {guidance.here ? <li>{whereaboutsText(guidance.here)}</li> : null}
            {guidance.teeByGreen !== null ? (
              <li>
                Hole {target.number} tees off by the {ordinal(guidance.teeByGreen)} green.
              </li>
            ) : null}
            {guidance.waterOnTheWay ? (
              <li className="warn">
                <Warning size={15} weight="fill" /> Water crosses the straight line. Walk around it.
              </li>
            ) : null}
            {compass === null ? (
              <li className="quiet">
                {pointing
                  ? "No compass reading, so the arrow follows the way you are walking."
                  : "Walk a few steps and the arrow will point the way."}
              </li>
            ) : null}
          </ul>
        )}

        <LostMap
          holes={holes}
          target={target}
          tee={guidance.tee.point}
          player={usableFix}
          accuracyM={usableFix.accuracyM}
          hazards={hazards}
          trees={trees}
          arrived={arrived}
          headingDeg={compass}
        />
        <p className="lost-attribution">Course map: {geometry.bundle?.geometry.attribution}.</p>
      </>
    );
  }

  return (
    <div className="lost-guide" role="dialog" aria-modal="true" aria-labelledby="lost-guide-title">
      <div className="lost-guide-inner">
        <header className="lost-head">
          <span className="lost-head-label">
            <Compass size={15} weight="bold" /> FIND YOUR HOLE
          </span>
          <button type="button" className="lost-close" onClick={onClose} aria-label="Close and go back to the round">
            <X size={20} weight="bold" />
          </button>
        </header>

        <div className="lost-target">
          <button type="button" onClick={() => stepTarget(-1)} disabled={index <= 0} aria-label="Previous hole">
            <CaretLeft size={22} weight="bold" />
          </button>
          <div>
            <h2 id="lost-guide-title">Hole {targetNumber}</h2>
            <span>
              {[targetNumber === nextHole ? "Next on your card" : null, card ? `Par ${card.par} · ${card.yards} yds` : null]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
          <button
            type="button"
            onClick={() => stepTarget(1)}
            disabled={index === -1 || index >= holeNumbers.length - 1}
            aria-label="Next hole"
          >
            <CaretRight size={22} weight="bold" />
          </button>
        </div>

        <div className="lost-body">{body}</div>

        <div className="lost-actions">
          {arrived && target && guidance ? (
            <button type="button" className="primary-button full-width" onClick={() => onPlayHole(target.number)}>
              Play hole {target.number}
            </button>
          ) : null}
          <button type="button" className="secondary-button full-width" onClick={onClose}>
            Back to the round
          </button>
        </div>
      </div>
    </div>
  );
}
