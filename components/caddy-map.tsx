"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  buildFrame,
  scaleM,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  type FramePoint,
  type ViewFrame,
} from "@/lib/caddy-view-frame";
import { destination, yardsToMetres } from "@/lib/geo";
import type { CourseHazard, LatLng, PlayingHoleGeometry } from "@/lib/hole-geometry";
import type { ShotPlan } from "@/lib/shot-engine";

/**
 * The hole, drawn from real coordinates and rotated so the shot points up the screen.
 *
 * The reveal is driven by requestAnimationFrame rather than CSS keyframes. The stylesheet
 * disables every animation under prefers-reduced-motion with an `!important` rule, so a CSS
 * approach could not honour that preference deliberately — it would simply be switched off
 * mid-way. Driving it from script means the reduced path is one call to the final frame.
 */

interface CaddyMapProps {
  hole: PlayingHoleGeometry;
  plan: ShotPlan;
  player: LatLng;
  accuracyM: number;
  hazards: CourseHazard[];
  /** Drawn faintly, with no player or shot, while waiting for a first fix. */
  dimmed?: boolean;
}

const REVEAL = {
  settle: { start: 0, end: 260 },
  player: { start: 200, end: 420 },
  arc: { start: 380, end: 1000 },
  land: { start: 940, end: 1180 },
  total: 1180,
};

/** Ceilings for the uncertainty shapes, in viewBox units. */
const MAX_HALO_UNITS = 42;
const MAX_SPREAD_UNITS = 54;

const clampRadius = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function stageProgress(elapsed: number, stage: { start: number; end: number }): number {
  return clamp01((elapsed - stage.start) / (stage.end - stage.start));
}

function toPath(points: FramePoint[], close = false): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  const body = rest.map((point) => `L${point.x.toFixed(1)},${point.y.toFixed(1)}`).join("");
  return `M${first.x.toFixed(1)},${first.y.toFixed(1)}${body}${close ? "Z" : ""}`;
}

/**
 * The shot line, bowed sideways.
 *
 * A top-down map has no apex to show, so the bow is the airline-map convention rather than
 * a claim about trajectory: it separates the shot from the straight centreline underneath
 * and grows with the length of the shot.
 */
function shotPath(from: FramePoint, to: FramePoint, bowRatio: number): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return toPath([from, to]);

  const bow = length * bowRatio;
  // Perpendicular to the shot, chosen so the curve bends toward whichever side has more
  // room, which keeps it clear of the green labels.
  const side = from.x > VIEW_WIDTH / 2 ? -1 : 1;
  const control = {
    x: (from.x + to.x) / 2 + ((-dy / length) * bow) * side,
    y: (from.y + to.y) / 2 + ((dx / length) * bow) * side,
  };
  return `M${from.x.toFixed(1)},${from.y.toFixed(1)} Q${control.x.toFixed(1)},${control.y.toFixed(1)} ${to.x.toFixed(1)},${to.y.toFixed(1)}`;
}

function hazardClass(kind: CourseHazard["kind"]): string {
  if (kind === "bunker") return "caddy-hazard bunker";
  if (kind === "out_of_bounds") return "caddy-hazard ob";
  return "caddy-hazard water";
}

export function CaddyMap({ hole, plan, player, accuracyM, hazards, dimmed = false }: CaddyMapProps) {
  const group = useRef<SVGGElement | null>(null);
  const arc = useRef<SVGPathElement | null>(null);
  const ball = useRef<SVGCircleElement | null>(null);
  const playerDot = useRef<SVGCircleElement | null>(null);
  const halo = useRef<SVGCircleElement | null>(null);
  const spread = useRef<SVGEllipseElement | null>(null);

  const scene = useMemo(() => {
    const rollEnd = destination(plan.target, plan.bearingDeg, yardsToMetres(plan.rollYds));
    const frame: ViewFrame = buildFrame({
      player,
      target: plan.target,
      green: hole.greenCentre,
      extra: [
        ...hole.centreline,
        ...(hole.greenPolygon ?? [hole.greenFront, hole.greenBack]),
        rollEnd,
      ],
    });

    const at = (point: LatLng) => frame.project(point);
    const from = at(player);
    const to = at(plan.target);
    const length = Math.hypot(to.x - from.x, to.y - from.y);

    return {
      frame,
      from,
      to,
      rollEnd: at(rollEnd),
      // Longer shots bow more, so a drive reads as a shot and a chip reads as a line.
      bowRatio: 0.05 + 0.09 * clamp01(length / VIEW_HEIGHT),
      centreline: hole.centreline.map(at),
      greenRing: hole.greenPolygon?.map(at) ?? null,
      greenCentre: at(hole.greenCentre),
      greenFront: at(hole.greenFront),
      greenBack: at(hole.greenBack),
      hazards: hazards.map((hazard) => ({
        hazard,
        centre: at(hazard.centre),
        radius: scaleM(frame, hazard.radiusM),
        outline: hazard.outline.length >= 3 ? hazard.outline.map(at) : null,
      })),
      // Capped so a bad fix still reads as uncertainty rather than covering the hole. The
      // exact figure stays honest in the yardage band and the warning line beneath.
      haloRadius: clampRadius(scaleM(frame, accuracyM), 4, MAX_HALO_UNITS),
      spreadRx: clampRadius(scaleM(frame, yardsToMetres(plan.dispersion.lateralYds)), 3, MAX_SPREAD_UNITS),
      spreadRy: clampRadius(scaleM(frame, yardsToMetres(plan.dispersion.longYds)), 3, MAX_SPREAD_UNITS),
      // The fairway corridor stands in when OSM mapped no fairway polygon, which is most
      // holes on most courses.
      corridorWidth: Math.max(8, scaleM(frame, 45)),
    };
  }, [hole, plan, player, accuracyM, hazards]);

  const shotD = shotPath(scene.from, scene.to, scene.bowRatio);
  const spreadAngle = (Math.atan2(scene.to.x - scene.from.x, scene.from.y - scene.to.y) * 180) / Math.PI;

  useEffect(() => {
    if (dimmed) return;

    const arcNode = arc.current;
    const length = arcNode?.getTotalLength?.() ?? 0;

    const applyFrame = (elapsed: number) => {
      const settle = easeOutCubic(stageProgress(elapsed, REVEAL.settle));
      const enter = easeOutCubic(stageProgress(elapsed, REVEAL.player));
      const draw = easeOutCubic(stageProgress(elapsed, REVEAL.arc));
      const land = easeOutCubic(stageProgress(elapsed, REVEAL.land));

      if (group.current) {
        group.current.style.opacity = String(settle);
        // A touch of scale on the way in, so the map settles rather than blinking on.
        const zoom = 1 + 0.1 * (1 - settle);
        group.current.style.transform = `scale(${zoom.toFixed(4)})`;
      }
      if (playerDot.current) playerDot.current.setAttribute("r", (5.5 * enter).toFixed(2));
      if (halo.current) halo.current.setAttribute("r", (scene.haloRadius * enter).toFixed(2));

      if (arcNode && length > 0) {
        arcNode.style.strokeDasharray = String(length);
        arcNode.style.strokeDashoffset = String(length * (1 - draw));
      }
      if (ball.current && arcNode && length > 0) {
        const point = arcNode.getPointAtLength(length * draw);
        ball.current.setAttribute("cx", point.x.toFixed(2));
        ball.current.setAttribute("cy", point.y.toFixed(2));
        ball.current.setAttribute("r", draw > 0.02 && draw < 1 ? "3.6" : "0");
      }
      if (spread.current) {
        spread.current.setAttribute("rx", (scene.spreadRx * land).toFixed(2));
        spread.current.setAttribute("ry", (scene.spreadRy * land).toFixed(2));
        spread.current.style.opacity = String(land);
      }
    };

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    // A phone in a pocket should not be burning frames on an animation nobody can see.
    if (reduced?.matches || document.visibilityState === "hidden") {
      applyFrame(REVEAL.total);
      return;
    }

    let raf = 0;
    const started = performance.now();
    const step = (now: number) => {
      const elapsed = now - started;
      applyFrame(elapsed);
      if (elapsed < REVEAL.total) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [scene, shotD, dimmed]);

  return (
    <svg
      className="caddy-view-map"
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Hole ${hole.number}: ${Math.round(plan.targetYds)} yards to the target, ${Math.round(plan.green.centreYds)} to the middle of the green.`}
    >
      <g
        ref={group}
        className="caddy-map-group"
        style={{
          opacity: dimmed ? 0.35 : 0,
          transformOrigin: `${VIEW_WIDTH / 2}px ${VIEW_HEIGHT / 2}px`,
        }}
      >
        <path className="caddy-fairway" d={toPath(scene.centreline)} strokeWidth={scene.corridorWidth} />

        {scene.hazards.map((item) =>
          item.outline ? (
            <path key={item.hazard.osmId} className={hazardClass(item.hazard.kind)} d={toPath(item.outline, true)} />
          ) : (
            <circle
              key={item.hazard.osmId}
              className={hazardClass(item.hazard.kind)}
              cx={item.centre.x}
              cy={item.centre.y}
              r={Math.max(2, item.radius)}
            />
          ),
        )}

        {scene.greenRing ? (
          <path className="caddy-green-shape" d={toPath(scene.greenRing, true)} />
        ) : (
          <circle className="caddy-green-shape" cx={scene.greenCentre.x} cy={scene.greenCentre.y} r={10} />
        )}

        <path className="caddy-centreline" d={toPath(scene.centreline)} />

        <g className="caddy-flag">
          <line
            className="caddy-flag-pole"
            x1={scene.greenCentre.x}
            y1={scene.greenCentre.y}
            x2={scene.greenCentre.x}
            y2={scene.greenCentre.y - 19}
          />
          <path
            className="caddy-flag-cloth"
            d={`M${scene.greenCentre.x},${scene.greenCentre.y - 19} l10,3.5 l-10,3.5 Z`}
          />
        </g>

        {dimmed ? null : (
          <>
            {plan.rollYds > 0 ? (
              <path
                className="caddy-shot-roll"
                d={`M${scene.to.x.toFixed(1)},${scene.to.y.toFixed(1)} L${scene.rollEnd.x.toFixed(1)},${scene.rollEnd.y.toFixed(1)}`}
              />
            ) : null}
            <path
              ref={arc}
              className={plan.laidUp ? "caddy-shot-arc layup" : "caddy-shot-arc"}
              d={shotD}
            />
            <ellipse
              ref={spread}
              className="caddy-dispersion"
              cx={scene.to.x}
              cy={scene.to.y}
              rx={0}
              ry={0}
              transform={`rotate(${spreadAngle.toFixed(1)} ${scene.to.x.toFixed(1)} ${scene.to.y.toFixed(1)})`}
            />
            <circle ref={ball} className="caddy-ball" cx={scene.from.x} cy={scene.from.y} r={0} />
            <circle ref={halo} className="caddy-accuracy" cx={scene.from.x} cy={scene.from.y} r={0} />
            <circle ref={playerDot} className="caddy-player-core" cx={scene.from.x} cy={scene.from.y} r={0} />
          </>
        )}
      </g>
    </svg>
  );
}
