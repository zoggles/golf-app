"use client";

import { memo, useMemo } from "react";
import { buildFrame, scaleM, VIEW_HEIGHT, VIEW_WIDTH, type FramePoint } from "@/lib/caddy-view-frame";
import type { CourseHazard, LatLng, PlayingHoleGeometry, TreeArea } from "@/lib/hole-geometry";

/**
 * The way back to the right hole, drawn from the course map.
 *
 * Turned so the tee you are heading for is straight up the screen, the same convention as
 * Caddy View, so facing the arrow makes the map match the ground in front of you. Every hole
 * in view carries its number at its tee, because a lost golfer steers by the holes they can
 * see, not by a compass rose.
 */

interface LostMapProps {
  holes: PlayingHoleGeometry[];
  target: PlayingHoleGeometry;
  tee: LatLng;
  player: LatLng;
  accuracyM: number;
  hazards: CourseHazard[];
  trees: TreeArea[];
  /** Once there, the hole itself runs up the screen, rather than a line to a spot underfoot. */
  arrived: boolean;
  /** Compass heading, drawn as a cone on the player. */
  headingDeg: number | null;
}

const MAX_HALO_UNITS = 36;
const CONE_LENGTH = 30;
const CONE_HALF_ANGLE_DEG = 24;

function toPath(points: FramePoint[], close = false): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  const body = rest.map((point) => `L${point.x.toFixed(1)},${point.y.toFixed(1)}`).join("");
  return `M${first.x.toFixed(1)},${first.y.toFixed(1)}${body}${close ? "Z" : ""}`;
}

function hazardClass(kind: CourseHazard["kind"]): string {
  if (kind === "bunker") return "caddy-hazard bunker";
  if (kind === "out_of_bounds") return "caddy-hazard ob";
  return "caddy-hazard water";
}

function useScene({ holes, target, tee, player, accuracyM, hazards, trees, arrived }: Omit<LostMapProps, "headingDeg">) {
  return useMemo(() => {
    const frame = buildFrame({
      player,
      target: arrived ? target.greenCentre : tee,
      green: target.greenCentre,
      extra: [tee, ...target.centreline],
      marginM: 35,
    });
    const at = (point: LatLng) => frame.project(point);
    return {
      upBearingDeg: frame.upBearingDeg,
      corridorWidth: Math.max(3, scaleM(frame, 36)),
      holes: holes.map((hole) => ({
        number: hole.number,
        isTarget: hole.number === target.number,
        line: toPath(hole.centreline.map(at)),
        green: hole.greenPolygon ? toPath(hole.greenPolygon.map(at), true) : null,
        greenCentre: at(hole.greenCentre),
        greenRadius: Math.max(3, scaleM(frame, 14)),
        tee: at(hole.tee),
      })),
      hazards: hazards.map((hazard) => ({
        id: hazard.osmId,
        className: hazardClass(hazard.kind),
        outline: hazard.outline.length >= 3 ? toPath(hazard.outline.map(at), true) : null,
        centre: at(hazard.centre),
        radius: Math.max(2, scaleM(frame, hazard.radiusM)),
      })),
      trees: trees
        .filter((area) => area.outline.length >= 3)
        .map((area) => ({ id: area.osmId, outline: toPath(area.outline.map(at), true) })),
      tee: at(tee),
      player: at(player),
      halo: Math.min(MAX_HALO_UNITS, Math.max(4, scaleM(frame, accuracyM))),
    };
  }, [holes, target, tee, player, accuracyM, hazards, trees, arrived]);
}

type Scene = ReturnType<typeof useScene>;

/**
 * Everything but the heading cone. The compass redraws the cone ten times a second, and a
 * whole course of tree outlines has no reason to be redrawn with it.
 */
const Ground = memo(function Ground({ scene, arrived }: { scene: Scene; arrived: boolean }) {
  const target = scene.holes.find((hole) => hole.isTarget);
  // North sits wherever turning the map left it: up is the way to the tee, not north.
  const north = { x: VIEW_WIDTH - 28, y: 30 };

  return (
    <>
      {scene.holes.map((hole) => (
        <path
          key={`fairway-${hole.number}`}
          className={hole.isTarget ? "caddy-fairway lost-fairway-target" : "caddy-fairway"}
          d={hole.line}
          strokeWidth={scene.corridorWidth}
        />
      ))}
      {scene.trees.map((area) => (
        <path key={area.id} className="caddy-trees" d={area.outline} />
      ))}
      {scene.hazards.map((hazard) =>
        hazard.outline ? (
          <path key={hazard.id} className={hazard.className} d={hazard.outline} />
        ) : (
          <circle key={hazard.id} className={hazard.className} cx={hazard.centre.x} cy={hazard.centre.y} r={hazard.radius} />
        ),
      )}
      {scene.holes.map((hole) =>
        hole.green ? (
          <path key={`green-${hole.number}`} className="caddy-green-shape lost-green" d={hole.green} />
        ) : (
          <circle
            key={`green-${hole.number}`}
            className="caddy-green-shape lost-green"
            cx={hole.greenCentre.x}
            cy={hole.greenCentre.y}
            r={hole.greenRadius}
          />
        ),
      )}
      {target ? <path className="lost-target-line" d={target.line} /> : null}

      {arrived ? null : (
        <line
          className="lost-route"
          x1={scene.player.x}
          y1={scene.player.y}
          x2={scene.tee.x}
          y2={scene.tee.y}
        />
      )}

      {scene.holes
        .filter((hole) => !hole.isTarget)
        .map((hole) => (
          <g key={`tee-${hole.number}`} className="lost-tee-badge">
            <circle cx={hole.tee.x} cy={hole.tee.y} r={7} />
            <text x={hole.tee.x} y={hole.tee.y}>
              {hole.number}
            </text>
          </g>
        ))}
      {target ? (
        <g className="lost-tee-badge target">
          <circle className="lost-target-ring" cx={scene.tee.x} cy={scene.tee.y} r={15} />
          <circle cx={scene.tee.x} cy={scene.tee.y} r={10} />
          <text x={scene.tee.x} y={scene.tee.y}>
            {target.number}
          </text>
        </g>
      ) : null}

      <g className="lost-north" aria-hidden="true">
        <circle cx={north.x} cy={north.y} r={13} />
        <path
          d={`M${north.x},${north.y - 21} L${north.x + 5},${north.y - 13} L${north.x - 5},${north.y - 13} Z`}
          transform={`rotate(${(-scene.upBearingDeg).toFixed(1)} ${north.x} ${north.y})`}
        />
        <text x={north.x} y={north.y}>
          N
        </text>
      </g>
    </>
  );
});

export function LostMap(props: LostMapProps) {
  const scene = useScene(props);
  const { headingDeg, arrived, target } = props;

  let cone: string | null = null;
  if (headingDeg !== null) {
    const { x, y } = scene.player;
    const edge = (offsetDeg: number) => {
      const radians = ((headingDeg - scene.upBearingDeg + offsetDeg) * Math.PI) / 180;
      return `${(x + Math.sin(radians) * CONE_LENGTH).toFixed(1)},${(y - Math.cos(radians) * CONE_LENGTH).toFixed(1)}`;
    };
    cone = `M${x.toFixed(1)},${y.toFixed(1)} L${edge(-CONE_HALF_ANGLE_DEG)} L${edge(CONE_HALF_ANGLE_DEG)} Z`;
  }

  return (
    <svg
      className="lost-map"
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Map of the course from where you are to the tee of hole ${target.number}`}
    >
      <Ground scene={scene} arrived={arrived} />
      {cone ? <path className="lost-heading" d={cone} /> : null}
      <circle className="caddy-accuracy" cx={scene.player.x} cy={scene.player.y} r={scene.halo} />
      <circle className="caddy-player-core" cx={scene.player.x} cy={scene.player.y} r={5.5} />
    </svg>
  );
}
