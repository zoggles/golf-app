"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowCounterClockwise,
  ArrowsOutSimple,
  CrosshairSimple,
  HandPointing,
  MapPinSimple,
  Path,
  Spinner,
  Warning,
  X,
} from "@phosphor-icons/react";
import { BagEditor } from "@/components/bag-editor";
import { CaddyMap } from "@/components/caddy-map";
import { ClubCallout } from "@/components/club-callout";
import { ObstacleList } from "@/components/obstacle-list";
import { useBag } from "@/hooks/use-bag";
import { useCourseGeometry } from "@/hooks/use-course-geometry";
import { usePlayerPosition } from "@/hooks/use-player-position";
import { useCaddyViewPrefs } from "@/hooks/use-caddy-view-prefs";
import { captureGreen, ensureCourseGeometry, refreshCourseGeometry } from "@/lib/course-geometry-cache";
import { courseKey } from "@/lib/course-key";
import { haversineM, metresToYards } from "@/lib/geo";
import { playingHole, playingHoles, type CourseHazard, type LatLng, type TreeArea } from "@/lib/hole-geometry";
import { obstaclesAhead, obstaclesForShot, waterAdvice } from "@/lib/hole-obstacles";
import { setCaddyViewPrefs } from "@/lib/caddy-view-prefs";
import { detectHole, planShot, planShotAt, type ShotPlan } from "@/lib/shot-engine";
import type { Course, Hole } from "@/lib/types";

/**
 * The live GPS hole map, in place of the static club tip.
 *
 * Owns its own position watch, so turning the feature off unmounts this and the watch dies
 * with it. Every failure lands on a state that still shows the club tip, so the round is
 * never worse off for having tried.
 */

/** Past this the fix is too vague to quote a single number from. */
const WEAK_FIX_M = 25;
/** Android's approximate-location grant lands in the hundreds of metres. Useless here. */
const COARSE_FIX_M = 150;
/** Walk this far from where a target was set and that shot has been played. */
const AIM_RESET_M = 25;

const NO_HAZARDS: CourseHazard[] = [];
const NO_TREES: TreeArea[] = [];

/** A target the golfer put on the map in place of the caddy's. */
interface Aim {
  hole: number;
  point: LatLng;
  /** Where the golfer stood when they set it. */
  from: LatLng;
}

/** "Leaves 148 in: 7 iron." — the shot after this one, when there is one. */
function leaveLine(plan: ShotPlan): string | null {
  if (!plan.leave) return null;
  const yds = Math.round(plan.leave.yds);
  return plan.leave.club ? `Leaves ${yds} in: ${plan.leave.club.label.toLowerCase()}.` : `Leaves ${yds} in.`;
}

interface CaddyViewProps {
  hole: Hole;
  course: Course;
  golferId: string | null;
  onDisable: () => void;
  onSelectHole: (holeNumber: number) => void;
}

export function CaddyView({ hole, course, golferId, onDisable, onSelectHole }: CaddyViewProps) {
  const prefs = useCaddyViewPrefs();
  const bag = useBag(golferId);
  const key = useMemo(() => courseKey(course), [course]);
  const geometry = useCourseGeometry(key);
  const position = usePlayerPosition(true);
  const [expanded, setExpanded] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  // Tracked by hole number rather than a flag that an effect has to reset: dismissing the
  // hint on one hole should not silence it on the next.
  const [hintDismissedFor, setHintDismissedFor] = useState<number | null>(null);
  const [aim, setAim] = useState<Aim | null>(null);

  const fix = position.state === "tracking" ? position.fix : null;
  const lat = fix?.lat;
  const lng = fix?.lng;
  const accuracyM = fix?.accuracyM;
  // One object per position rather than per render, so the map redraws when you move and
  // not every time a fix arrives saying you have not.
  const player = useMemo(() => (lat !== undefined && lng !== undefined ? { lat, lng } : null), [lat, lng]);

  // The map downloads as soon as Caddy View opens. That needs no position, only the course.
  useEffect(() => {
    void refreshCourseGeometry(key, course.holes.length);
  }, [key, course.holes.length]);

  // One resolve per course, plus a second look a session when the saved copy has gaps.
  // Everything after the first round is served from the cache.
  useEffect(() => {
    if (!fix) return;
    void ensureCourseGeometry({
      courseKey: key,
      fix: { lat: fix.lat, lng: fix.lng },
      holes: course.holes.map((item) => ({
        number: item.number,
        par: item.par,
        yards: item.yards,
        handicap: item.handicap,
      })),
    });
  }, [fix, key, course.holes]);

  const holeGeometry = useMemo(
    () => (geometry.bundle ? playingHole(geometry.bundle, hole.number) : null),
    [geometry.bundle, hole.number],
  );
  const hazards = geometry.bundle?.geometry.hazards ?? NO_HAZARDS;
  const trees = geometry.bundle?.geometry.trees ?? NO_TREES;

  // The caddy's own shot. It also frames the map, so the view holds still while a target
  // is dragged around it.
  const recommended = useMemo(
    () =>
      holeGeometry && player && accuracyM !== undefined
        ? planShot({ from: player, hole: holeGeometry, hazards, bag, accuracyM })
        : null,
    [holeGeometry, player, hazards, bag, accuracyM],
  );

  // Read through rather than cleared by an effect: a target set on another hole, or before
  // the last shot was hit, simply stops applying.
  const aimPoint =
    aim && player && aim.hole === hole.number && haversineM(player, aim.from) <= AIM_RESET_M ? aim.point : null;

  const plan = useMemo(
    () =>
      recommended && !recommended.onGreen && aimPoint && holeGeometry && player && accuracyM !== undefined
        ? planShotAt({ from: player, hole: holeGeometry, hazards, bag, accuracyM }, aimPoint)
        : recommended,
    [recommended, aimPoint, holeGeometry, player, hazards, bag, accuracyM],
  );

  // Every mapped edge on the course, measured from where you stand. Kept apart from the
  // target so dragging it does not walk them all again on every frame.
  const ahead = useMemo(
    () => (holeGeometry && player ? obstaclesAhead({ from: player, hole: holeGeometry, hazards, trees }) : []),
    [holeGeometry, player, hazards, trees],
  );
  const obstacles =
    plan && !plan.onGreen
      ? obstaclesForShot(ahead, {
          targetYds: plan.targetYds,
          longYds: plan.dispersion.longYds,
          rollYds: plan.rollYds,
        })
      : [];
  // A lay-up already says what it is laying up short of, so it gets no second line.
  const advice =
    player && plan && !plan.onGreen && !plan.laidUp
      ? waterAdvice({
          from: player,
          target: plan.target,
          targetYds: plan.targetYds,
          rollYds: plan.rollYds,
          dispersion: plan.dispersion,
          hazards,
        })
      : null;

  function aimAt(point: LatLng) {
    if (player) setAim({ hole: hole.number, point, from: player });
  }

  const suggestedHole =
    fix && geometry.bundle && prefs.autoHoleHint && hintDismissedFor !== hole.number
      ? detectHole({ lat: fix.lat, lng: fix.lng }, playingHoles(geometry.bundle), hole.number)
      : hole.number;

  async function saveGreenHere() {
    if (!fix) return;
    setCapturing(true);
    setCaptureError(null);
    try {
      await captureGreen({
        courseKey: key,
        holeNumber: hole.number,
        green: { lat: fix.lat, lng: fix.lng },
      });
    } catch (cause) {
      setCaptureError(cause instanceof Error ? cause.message : "Could not save that green.");
    } finally {
      setCapturing(false);
    }
  }

  const shell = (body: React.ReactNode) => (
    <>
      <div className={expanded ? "caddy-view caddy-view-expanded" : "caddy-view"}>
        <div className="caddy-head">
          <span className="caddy-head-label">
            <Path size={13} weight="bold" /> CADDY VIEW
          </span>
          {fix ? (
            <span className={fix.accuracyM > WEAK_FIX_M ? "caddy-signal weak" : "caddy-signal"}>
              <CrosshairSimple size={13} weight="bold" /> ±{Math.round(metresToYards(fix.accuracyM))} YD
            </span>
          ) : null}
        </div>
        {body}
      </div>
      <BagEditor bag={bag} golferId={golferId} />
    </>
  );

  const statusRow = (
    tone: "" | "warn" | "error",
    icon: React.ReactNode,
    message: string,
    action?: { label: string; onClick: () => void },
  ) => (
    <div className={tone ? `caddy-status ${tone}` : "caddy-status"} role="status">
      {icon}
      <span>{message}</span>
      {action ? (
        <button type="button" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </div>
  );

  if (position.state === "unsupported") {
    return shell(
      <>
        {statusRow("warn", <Warning size={16} weight="fill" />, "This device has no GPS.", {
          label: "Use the club tip",
          onClick: onDisable,
        })}
        <ClubCallout hole={hole} />
      </>,
    );
  }

  if (position.state === "denied") {
    return shell(
      <>
        {statusRow(
          "error",
          <Warning size={16} weight="fill" />,
          "Caddy View needs location access. You can still use the club tip.",
          { label: "Use the club tip", onClick: onDisable },
        )}
        <ClubCallout hole={hole} />
      </>,
    );
  }

  if (position.state === "error") {
    return shell(
      <>
        {statusRow("warn", <Warning size={16} weight="fill" />, position.message)}
        <ClubCallout hole={hole} />
      </>,
    );
  }

  if (fix && fix.accuracyM > COARSE_FIX_M) {
    return shell(
      <>
        {statusRow(
          "warn",
          <Warning size={16} weight="fill" />,
          "Only approximate location is being shared. Allow precise location for Caddy View.",
          { label: "Use the club tip", onClick: onDisable },
        )}
        <ClubCallout hole={hole} />
      </>,
    );
  }

  if (geometry.status === "error") {
    return shell(
      <>
        {statusRow("warn", <Warning size={16} weight="fill" />, "No hole map for this course yet.")}
        <ClubCallout hole={hole} />
      </>,
    );
  }

  // No geometry for this hole, but we know where you are: offer to capture the green.
  if (geometry.bundle && !holeGeometry) {
    return shell(
      <div className="caddy-pin-capture">
        <MapPinSimple size={26} weight="fill" />
        <p>
          Hole {hole.number} is not mapped yet. Walk onto the green and save it once — every
          round here after this will have real distances.
        </p>
        <button
          type="button"
          className="primary-button full-width"
          onClick={() => void saveGreenHere()}
          disabled={!fix || capturing}
        >
          {capturing ? "Saving…" : fix ? "Save the green here" : "Waiting for a fix…"}
        </button>
        {captureError ? <p className="voice-error">{captureError}</p> : null}
        <ClubCallout hole={hole} />
      </div>,
    );
  }

  // Geometry has arrived but the first fix has not. The hole still draws, so most of the
  // value is on screen before GPS settles.
  if (!fix || !player || !plan || !recommended || !holeGeometry) {
    return shell(
      <>
        {statusRow(
          "",
          <Spinner size={16} className="spin" />,
          geometry.status === "loading" ? "Loading the hole map…" : "Finding you…",
        )}
        <ClubCallout hole={hole} />
        {holeGeometry ? (
          <CaddyMap
            hole={holeGeometry}
            plan={{
              kind: "tee",
              target: holeGeometry.greenCentre,
              targetYds: 0,
              club: null,
              bearingDeg: 0,
              carries: [],
              laidUp: false,
              recovering: false,
              dispersion: { lateralYds: 0, longYds: 0 },
              rollYds: 0,
              green: { frontYds: 0, centreYds: 0, backYds: 0 },
              onGreen: false,
              reason: "",
              leave: null,
              custom: false,
            }}
            player={holeGeometry.tee}
            accuracyM={0}
            hazards={hazards}
            trees={trees}
            dimmed
          />
        ) : null}
      </>,
    );
  }

  const weak = fix.accuracyM > WEAK_FIX_M;
  const band = weak ? ` ±${Math.round(metresToYards(fix.accuracyM))}` : "";

  return shell(
    <>
      <div className="caddy-readout">
        <div>
          <small>{plan.onGreen ? "ON THE GREEN" : plan.custom ? "YOUR TARGET" : plan.laidUp ? "LAY UP" : "PLAY"}</small>
          <strong>
            {plan.club ? plan.club.club.label : plan.onGreen ? `${Math.round(plan.green.centreYds * 3)} ft` : "—"}
          </strong>
        </div>
        <p>
          {plan.onGreen
            ? "Putting from here. Distances are to the middle of the green."
            : [`${Math.round(plan.targetYds)}${band} yards to your target.`, plan.reason, leaveLine(plan), advice]
                .filter(Boolean)
                .join(" ")}
        </p>
      </div>

      <div className="caddy-distance-row">
        <div>
          <small>FRONT</small>
          <strong>{Math.round(plan.green.frontYds)}</strong>
        </div>
        <div>
          <small>MIDDLE</small>
          <strong className="caddy-primary-number">{Math.round(plan.green.centreYds)}</strong>
        </div>
        <div>
          <small>BACK</small>
          <strong>{Math.round(plan.green.backYds)}</strong>
        </div>
      </div>

      <ObstacleList rows={obstacles} />

      {suggestedHole !== hole.number ? (
        <div className="caddy-hole-hint">
          <MapPinSimple size={15} weight="fill" />
          <span>Looks like you are on hole {suggestedHole}.</span>
          <button type="button" onClick={() => onSelectHole(suggestedHole)}>
            Switch
          </button>
          <button type="button" onClick={() => setHintDismissedFor(hole.number)} aria-label="Dismiss">
            <X size={13} weight="bold" />
          </button>
        </div>
      ) : null}

      {weak
        ? statusRow(
            "warn",
            <Warning size={15} weight="fill" />,
            "Weak GPS signal, so these distances are approximate.",
          )
        : null}
      {plan.club && !plan.club.confident ? (
        statusRow(
          "warn",
          <Warning size={15} weight="fill" />,
          plan.custom
            ? "That is past everything in your bag."
            : "That is past everything in your bag. Set your carries under My clubs.",
        )
      ) : null}

      <div className="caddy-map-frame">
        <CaddyMap
          // A new hole or a change of shot is a new picture, so the reveal plays again.
          // A GPS tick or a dragged target is not, which is why neither is in the key.
          key={`${hole.number}-${recommended.kind}-${expanded}`}
          hole={holeGeometry}
          plan={plan}
          framing={recommended}
          player={player}
          accuracyM={fix.accuracyM}
          hazards={hazards}
          trees={trees}
          onAim={plan.onGreen ? undefined : aimAt}
        />
        {plan.custom ? (
          <button type="button" className="caddy-map-pill caddy-aim-reset" onClick={() => setAim(null)}>
            <ArrowCounterClockwise size={13} weight="bold" /> Reset target
          </button>
        ) : plan.onGreen ? null : (
          <span className="caddy-map-pill caddy-aim-hint" aria-hidden="true">
            <HandPointing size={13} weight="bold" /> Drag to aim
          </span>
        )}
        <button
          type="button"
          className="caddy-map-pill caddy-expand-hint"
          onClick={() => setExpanded((value) => !value)}
          aria-label={expanded ? "Shrink the hole map" : "Expand the hole map"}
        >
          {expanded ? <X size={13} weight="bold" /> : <ArrowsOutSimple size={13} weight="bold" />}
          {expanded ? "Shrink" : "Expand"}
        </button>
      </div>

      <p className="caddy-attribution">
        Hole map and hazards: {geometry.bundle?.geometry.attribution}. Not every tree or bunker
        is mapped. The caddy aims at the centre of the green, not the pin.
      </p>
      <button
        type="button"
        className="caddy-inline-off"
        onClick={() => {
          setCaddyViewPrefs({ enabled: false });
          onDisable();
        }}
      >
        Turn Caddy View off
      </button>
    </>,
  );
}
