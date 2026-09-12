"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowsOutSimple,
  CrosshairSimple,
  MapPinSimple,
  Path,
  Spinner,
  Warning,
  X,
} from "@phosphor-icons/react";
import { BagEditor } from "@/components/bag-editor";
import { CaddyMap } from "@/components/caddy-map";
import { ClubCallout } from "@/components/club-callout";
import { useBag } from "@/hooks/use-bag";
import { useCourseGeometry } from "@/hooks/use-course-geometry";
import { usePlayerPosition } from "@/hooks/use-player-position";
import { useCaddyViewPrefs } from "@/hooks/use-caddy-view-prefs";
import { captureGreen, ensureCourseGeometry } from "@/lib/course-geometry-cache";
import { courseKey } from "@/lib/course-key";
import { metresToYards } from "@/lib/geo";
import { playingHole, playingHoles } from "@/lib/hole-geometry";
import { setCaddyViewPrefs } from "@/lib/caddy-view-prefs";
import { detectHole, planShot } from "@/lib/shot-engine";
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

  const fix = position.state === "tracking" ? position.fix : null;

  // One resolve per course. Everything after the first round is served from the cache.
  useEffect(() => {
    if (!fix || geometry.bundle) return;
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
  }, [fix, geometry.bundle, key, course.holes]);

  const holeGeometry = geometry.bundle ? playingHole(geometry.bundle, hole.number) : null;
  const plan =
    holeGeometry && fix
      ? planShot({
          from: { lat: fix.lat, lng: fix.lng },
          hole: holeGeometry,
          hazards: geometry.bundle?.geometry.hazards ?? [],
          bag,
          accuracyM: fix.accuracyM,
        })
      : null;

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
            <Path size={13} weight="bold" /> HOLE {hole.number} · PAR {hole.par} · {hole.yards} YDS
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
  if (!fix || !plan || !holeGeometry) {
    return shell(
      <>
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
            }}
            player={holeGeometry.tee}
            accuracyM={0}
            hazards={geometry.bundle?.geometry.hazards ?? []}
            dimmed
          />
        ) : null}
        {statusRow(
          "",
          <Spinner size={16} className="spin" />,
          geometry.status === "loading" ? "Loading the hole map…" : "Finding you…",
        )}
        <ClubCallout hole={hole} />
      </>,
    );
  }

  const weak = fix.accuracyM > WEAK_FIX_M;
  const band = weak ? ` ±${Math.round(metresToYards(fix.accuracyM))}` : "";
  const carryToClear = plan.carries.find((carry) => !carry.carried);

  return shell(
    <>
      <button
        type="button"
        className="caddy-map-button"
        onClick={() => setExpanded((value) => !value)}
        aria-label={expanded ? "Shrink the hole map" : "Expand the hole map"}
      >
        <CaddyMap
          // A new hole or a change of shot is a new picture, so the reveal plays again.
          // A GPS tick alone is not, which is why accuracy and position are not in the key.
          key={`${hole.number}-${plan.kind}-${expanded}`}
          hole={holeGeometry}
          plan={plan}
          player={{ lat: fix.lat, lng: fix.lng }}
          accuracyM={fix.accuracyM}
          hazards={geometry.bundle?.geometry.hazards ?? []}
        />
        <span className="caddy-expand-hint">
          {expanded ? <X size={13} weight="bold" /> : <ArrowsOutSimple size={13} weight="bold" />}
          {expanded ? "Shrink" : "Expand"}
        </span>
      </button>

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

      <div className="caddy-readout">
        <div>
          <small>{plan.onGreen ? "ON THE GREEN" : plan.laidUp ? "LAY UP" : "PLAY"}</small>
          <strong>
            {plan.club ? plan.club.club.label : plan.onGreen ? `${Math.round(plan.green.centreYds * 3)} ft` : "—"}
          </strong>
        </div>
        <p>
          {plan.onGreen
            ? "Putting from here. Distances are to the middle of the green."
            : `${Math.round(plan.targetYds)}${band} yards to your target. ${plan.reason}${
                carryToClear
                  ? ` Carry the ${carryToClear.hazard.kind === "bunker" ? "bunker" : "water"} at ${Math.round(carryToClear.nearEdgeYds)}.`
                  : ""
              }`}
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
          "That is past everything in your bag. Set your carries under My clubs.",
        )
      ) : null}

      <p className="caddy-attribution">
        Hole map: {geometry.bundle?.geometry.attribution}. Aiming at the centre of the green,
        not the pin.
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
