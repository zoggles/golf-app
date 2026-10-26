"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { clubShort, type Club } from "@/lib/bag";
import {
  buildFrame,
  scaleM,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  type FramePoint,
  type ViewFrame,
} from "@/lib/caddy-view-frame";
import { destination, yardsToMetres } from "@/lib/geo";
import type { CourseHazard, LatLng, PlayingHoleGeometry, TreeArea } from "@/lib/hole-geometry";
import type { ShotPlan } from "@/lib/shot-engine";

/**
 * The hole, drawn from real coordinates and rotated so the shot points up the screen.
 *
 * The reveal is driven by requestAnimationFrame rather than CSS keyframes. The stylesheet
 * disables every animation under prefers-reduced-motion with an `!important` rule, so a CSS
 * approach could not honour that preference deliberately — it would simply be switched off
 * mid-way. Driving it from script means the reduced path is one call to the final frame.
 *
 * The target can be dragged, or the map tapped, to aim somewhere else. The view stays fitted
 * to the caddy's own shot while that happens, so the hole holds still under the finger.
 */

interface CaddyMapProps {
  hole: PlayingHoleGeometry;
  /** The shot drawn: the caddy's, or one the golfer aimed themselves. */
  plan: ShotPlan;
  /** The caddy's own shot, which the view is fitted and rotated to. Defaults to `plan`. */
  framing?: ShotPlan;
  player: LatLng;
  accuracyM: number;
  hazards: CourseHazard[];
  /** Mapped tree cover, drawn beneath the hazards. */
  trees: TreeArea[];
  /** Drawn faintly, with no player or shot, while waiting for a first fix. */
  dimmed?: boolean;
  /** Present when the target can be moved. Called with each new aim point. */
  onAim?: (point: LatLng) => void;
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

/** A finger is about this wide in viewBox units on a phone, so the target is this easy to grab. */
const AIM_HIT_UNITS = 24;
/** Closer to the player than this is not a shot, and the target would sit on the player's dot. */
const MIN_AIM_YDS = 10;
/** How far one arrow key press moves the target. */
const NUDGE_YDS = 5;
/** Below this length a line has no room for its own number, which the readout carries anyway. */
const MIN_LABEL_UNITS = 34;
/** Gap between a line and its number, and how near an edge a number can sit before it flips. */
const LABEL_GAP_UNITS = 9;
const LABEL_ROOM_UNITS = 46;

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
 * The control point that bows the shot line sideways, or null for a shot too short to bow.
 *
 * A top-down map has no apex to show, so the bow is the airline-map convention rather than
 * a claim about trajectory: it separates the shot from the straight centreline underneath
 * and grows with the length of the shot.
 */
function bowControl(from: FramePoint, to: FramePoint, bowRatio: number): FramePoint | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return null;

  const bow = length * bowRatio;
  // Perpendicular to the shot, chosen so the curve bends toward whichever side has more
  // room, which keeps it clear of the green labels.
  const side = from.x > VIEW_WIDTH / 2 ? -1 : 1;
  return {
    x: (from.x + to.x) / 2 + ((-dy / length) * bow) * side,
    y: (from.y + to.y) / 2 + ((dx / length) * bow) * side,
  };
}

function shotPath(from: FramePoint, to: FramePoint, control: FramePoint | null): string {
  if (!control) return toPath([from, to]);
  return `M${from.x.toFixed(1)},${from.y.toFixed(1)} Q${control.x.toFixed(1)},${control.y.toFixed(1)} ${to.x.toFixed(1)},${to.y.toFixed(1)}`;
}

interface MapLabel {
  x: number;
  y: number;
  anchor: "start" | "end";
  yds: number;
  club: Club | null;
}

/** A number set beside a point, on the side asked for unless that runs it off the edge. */
function labelBeside(point: FramePoint, side: number, yds: number, club: Club | null): MapLabel {
  let toward = side >= 0 ? 1 : -1;
  if (toward > 0 && point.x > VIEW_WIDTH - LABEL_ROOM_UNITS) toward = -1;
  else if (toward < 0 && point.x < LABEL_ROOM_UNITS) toward = 1;
  return {
    x: point.x + toward * LABEL_GAP_UNITS,
    y: Math.min(VIEW_HEIGHT - 10, Math.max(14, point.y)),
    anchor: toward > 0 ? "start" : "end",
    yds,
    club,
  };
}

function hazardClass(kind: CourseHazard["kind"]): string {
  if (kind === "bunker") return "caddy-hazard bunker";
  if (kind === "out_of_bounds") return "caddy-hazard ob";
  return "caddy-hazard water";
}

function shotArcClass(plan: ShotPlan): string {
  if (plan.custom) return "caddy-shot-arc custom";
  return plan.laidUp ? "caddy-shot-arc layup" : "caddy-shot-arc";
}

export function CaddyMap({
  hole,
  plan,
  framing,
  player,
  accuracyM,
  hazards,
  trees,
  dimmed = false,
  onAim,
}: CaddyMapProps) {
  const svg = useRef<SVGSVGElement | null>(null);
  const group = useRef<SVGGElement | null>(null);
  const arc = useRef<SVGPathElement | null>(null);
  const ball = useRef<SVGCircleElement | null>(null);
  const playerDot = useRef<SVGCircleElement | null>(null);
  const halo = useRef<SVGCircleElement | null>(null);
  const spread = useRef<SVGEllipseElement | null>(null);
  const aimLayer = useRef<SVGGElement | null>(null);
  const handle = useRef<SVGGElement | null>(null);
  // Set on the reveal's first frame and kept for the life of the map, so a GPS tick or a
  // dragged target part-way through carries the reveal on instead of starting it again.
  const revealStart = useRef<number | null>(null);
  const pendingAim = useRef<{ frame: number; point: FramePoint | null }>({ frame: 0, point: null });
  const [dragging, setDragging] = useState(false);

  const aimable = Boolean(onAim) && !dimmed;
  const frameOn = framing ?? plan;

  // Everything that holds still while the target moves.
  const scene = useMemo(() => {
    const rollEnd = destination(frameOn.target, frameOn.bearingDeg, yardsToMetres(frameOn.rollYds));
    const frame: ViewFrame = buildFrame({
      player,
      target: frameOn.target,
      green: hole.greenCentre,
      extra: [
        ...hole.centreline,
        ...(hole.greenPolygon ?? [hole.greenFront, hole.greenBack]),
        rollEnd,
      ],
    });

    const at = (point: LatLng) => frame.project(point);

    return {
      frame,
      from: at(player),
      centreline: hole.centreline.map(at),
      greenRing: hole.greenPolygon?.map(at) ?? null,
      greenCentre: at(hole.greenCentre),
      hazards: hazards.map((hazard) => ({
        hazard,
        centre: at(hazard.centre),
        radius: scaleM(frame, hazard.radiusM),
        outline: hazard.outline.length >= 3 ? hazard.outline.map(at) : null,
      })),
      trees: trees.filter((area) => area.outline.length >= 3).map((area) => ({ id: area.osmId, outline: area.outline.map(at) })),
      // The fairway corridor stands in when OSM mapped no fairway polygon, which is most
      // holes on most courses.
      corridorWidth: Math.max(8, scaleM(frame, 45)),
    };
  }, [hole, frameOn.target, frameOn.bearingDeg, frameOn.rollYds, player, hazards, trees]);

  // The shot itself, redrawn as the target moves.
  const shot = useMemo(() => {
    const at = (point: LatLng) => scene.frame.project(point);
    const from = scene.from;
    const to = at(plan.target);
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    // Longer shots bow more, so a drive reads as a shot and a chip reads as a line.
    const control = bowControl(from, to, 0.05 + 0.09 * clamp01(length / VIEW_HEIGHT));
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    // The middle of a quadratic curve sits halfway between the chord and the control point.
    const apex = control ? { x: (mid.x + control.x) / 2, y: (mid.y + control.y) / 2 } : mid;
    const bowSide = control ? Math.sign(control.x - mid.x) || 1 : 1;

    const leaveLength = Math.hypot(scene.greenCentre.x - to.x, scene.greenCentre.y - to.y);
    const leaveMid = { x: (to.x + scene.greenCentre.x) / 2, y: (to.y + scene.greenCentre.y) / 2 };

    return {
      to,
      d: shotPath(from, to, control),
      rollEnd: at(destination(plan.target, plan.bearingDeg, yardsToMetres(plan.rollYds))),
      // Capped so a bad fix still reads as uncertainty rather than covering the hole. The
      // exact figure stays honest in the yardage band and the warning line beneath.
      haloRadius: clampRadius(scaleM(scene.frame, accuracyM), 4, MAX_HALO_UNITS),
      spreadRx: clampRadius(scaleM(scene.frame, yardsToMetres(plan.dispersion.lateralYds)), 3, MAX_SPREAD_UNITS),
      spreadRy: clampRadius(scaleM(scene.frame, yardsToMetres(plan.dispersion.longYds)), 3, MAX_SPREAD_UNITS),
      spreadAngle: (Math.atan2(to.x - from.x, from.y - to.y) * 180) / Math.PI,
      shotLabel:
        !plan.onGreen && length >= MIN_LABEL_UNITS
          ? labelBeside(apex, bowSide, plan.targetYds, plan.club?.club ?? null)
          : null,
      leaveLine: Boolean(plan.leave) && leaveLength >= 1,
      leaveLabel:
        plan.leave && leaveLength >= MIN_LABEL_UNITS
          ? labelBeside(leaveMid, -bowSide, plan.leave.yds, plan.leave.club)
          : null,
      // Where the caddy would have aimed, left faintly on the map once the golfer moves away.
      ghost: plan.custom && framing ? at(framing.target) : null,
    };
  }, [scene, plan, framing, accuracyM]);

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
      if (halo.current) halo.current.setAttribute("r", (shot.haloRadius * enter).toFixed(2));

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
        spread.current.setAttribute("rx", (shot.spreadRx * land).toFixed(2));
        spread.current.setAttribute("ry", (shot.spreadRy * land).toFixed(2));
        spread.current.style.opacity = String(land);
      }
      if (aimLayer.current) aimLayer.current.style.opacity = String(land);
    };

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    // A phone in a pocket should not be burning frames on an animation nobody can see.
    if (reduced?.matches || document.visibilityState === "hidden") {
      applyFrame(REVEAL.total);
      return;
    }

    const started = revealStart.current ?? performance.now();
    revealStart.current = started;
    if (performance.now() - started >= REVEAL.total) {
      applyFrame(REVEAL.total);
      return;
    }

    let raf = 0;
    const step = (now: number) => {
      const elapsed = now - started;
      applyFrame(elapsed);
      if (elapsed < REVEAL.total) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [shot, dimmed]);

  // React listens for touchstart passively, so only a native listener can stop the page
  // scrolling under a finger that is dragging the target.
  useEffect(() => {
    const node = handle.current;
    if (!node || !aimable) return;
    const hold = (event: TouchEvent) => event.preventDefault();
    node.addEventListener("touchstart", hold, { passive: false });
    return () => node.removeEventListener("touchstart", hold);
  }, [aimable]);

  useEffect(() => {
    const pending = pendingAim.current;
    return () => cancelAnimationFrame(pending.frame);
  }, []);

  /** A pointer position as a point of the drawing, held inside it. */
  function toView(clientX: number, clientY: number): FramePoint | null {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return {
      x: Math.min(VIEW_WIDTH, Math.max(0, point.x)),
      y: Math.min(VIEW_HEIGHT, Math.max(0, point.y)),
    };
  }

  /** Hands a new aim point up at most once a frame, however fast the pointer reports. */
  function aimAt(point: FramePoint | null) {
    if (!point || !onAim) return;
    const fromPlayer = Math.hypot(point.x - scene.from.x, point.y - scene.from.y);
    if (fromPlayer < scaleM(scene.frame, yardsToMetres(MIN_AIM_YDS))) return;

    const pending = pendingAim.current;
    pending.point = point;
    if (pending.frame) return;
    pending.frame = requestAnimationFrame(() => {
      const next = pending.point;
      pending.frame = 0;
      pending.point = null;
      if (next) onAim(scene.frame.unproject(next));
    });
  }

  function endDrag(event: React.PointerEvent<SVGGElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  }

  function nudge(event: React.KeyboardEvent<SVGGElement>) {
    const step = scaleM(scene.frame, yardsToMetres(NUDGE_YDS));
    const moves: Record<string, FramePoint> = {
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    // From any press still waiting for a frame, so quick presses add up instead of collapsing.
    const at = pendingAim.current.point ?? shot.to;
    aimAt({
      x: Math.min(VIEW_WIDTH, Math.max(0, at.x + move.x)),
      y: Math.min(VIEW_HEIGHT, Math.max(0, at.y + move.y)),
    });
  }

  const description = `Hole ${hole.number}: ${Math.round(plan.targetYds)} yards to the target, ${Math.round(plan.green.centreYds)} to the middle of the green.`;

  return (
    <svg
      ref={svg}
      className={aimable ? "caddy-view-map aimable" : "caddy-view-map"}
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      role={aimable ? "group" : "img"}
      aria-label={description}
      onClick={
        aimable
          ? (event) => {
              // A tap anywhere else on the hole moves the target there.
              if (handle.current?.contains(event.target as Node)) return;
              aimAt(toView(event.clientX, event.clientY));
            }
          : undefined
      }
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

        {scene.trees.map((area) => (
          <path key={area.id} className="caddy-trees" d={toPath(area.outline, true)} />
        ))}

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
                d={`M${shot.to.x.toFixed(1)},${shot.to.y.toFixed(1)} L${shot.rollEnd.x.toFixed(1)},${shot.rollEnd.y.toFixed(1)}`}
              />
            ) : null}
            <path ref={arc} className={shotArcClass(plan)} d={shot.d} />
            <ellipse
              ref={spread}
              className="caddy-dispersion"
              cx={shot.to.x}
              cy={shot.to.y}
              rx={0}
              ry={0}
              transform={`rotate(${shot.spreadAngle.toFixed(1)} ${shot.to.x.toFixed(1)} ${shot.to.y.toFixed(1)})`}
            />
            <circle ref={ball} className="caddy-ball" cx={scene.from.x} cy={scene.from.y} r={0} />
            <circle ref={halo} className="caddy-accuracy" cx={scene.from.x} cy={scene.from.y} r={0} />
            <circle ref={playerDot} className="caddy-player-core" cx={scene.from.x} cy={scene.from.y} r={0} />

            <g ref={aimLayer} style={{ opacity: 0 }}>
              {shot.leaveLine ? (
                <line
                  className="caddy-leave-line"
                  x1={shot.to.x}
                  y1={shot.to.y}
                  x2={scene.greenCentre.x}
                  y2={scene.greenCentre.y}
                />
              ) : null}
              {shot.ghost ? <circle className="caddy-aim-ghost" cx={shot.ghost.x} cy={shot.ghost.y} r={4.5} /> : null}
              {[shot.shotLabel, shot.leaveLabel].map((label, index) =>
                label ? (
                  <text
                    key={index}
                    className="caddy-map-label"
                    x={label.x}
                    y={label.y}
                    textAnchor={label.anchor}
                    dominantBaseline="middle"
                  >
                    <tspan>{Math.round(label.yds)}</tspan>
                    {label.club ? (
                      <tspan className="caddy-map-label-club" dx={3}>
                        {clubShort(label.club)}
                      </tspan>
                    ) : null}
                  </text>
                ) : null,
              )}
              <g
                ref={handle}
                className={dragging ? "caddy-aim dragging" : "caddy-aim"}
                transform={`translate(${shot.to.x.toFixed(1)} ${shot.to.y.toFixed(1)})`}
                tabIndex={aimable ? 0 : undefined}
                role={aimable ? "button" : undefined}
                aria-label={
                  aimable
                    ? `Target, ${Math.round(plan.targetYds)} yards. Drag it, or use the arrow keys, to aim somewhere else.`
                    : undefined
                }
                onPointerDown={
                  aimable
                    ? (event) => {
                        event.currentTarget.setPointerCapture(event.pointerId);
                        setDragging(true);
                      }
                    : undefined
                }
                onPointerMove={
                  aimable
                    ? (event) => {
                        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                        aimAt(toView(event.clientX, event.clientY));
                      }
                    : undefined
                }
                onPointerUp={aimable ? endDrag : undefined}
                onPointerCancel={aimable ? endDrag : undefined}
                onKeyDown={aimable ? nudge : undefined}
              >
                {aimable ? <circle className="caddy-aim-hit" r={AIM_HIT_UNITS} /> : null}
                <circle className="caddy-aim-ring" r={dragging ? 10 : 7} />
                <circle className="caddy-aim-dot" r={1.6} />
              </g>
            </g>
          </>
        )}
      </g>
    </svg>
  );
}
