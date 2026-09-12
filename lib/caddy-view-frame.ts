import { bearingDeg, localProjection } from "./geo";
import type { LatLng } from "./hole-geometry";

/**
 * Maps real coordinates onto the SVG the hole is drawn in.
 *
 * The frame is rotated so the shot line points up the screen, and fitted to the player,
 * the target and the green rather than to the whole hole. Because the player is always
 * inside the bounds, the view tightens on its own as you walk up — there is no separate
 * zoom to manage.
 */

export const VIEW_WIDTH = 320;
export const VIEW_HEIGHT = 400;
const DEFAULT_MARGIN_M = 25;

export interface FramePoint {
  x: number;
  y: number;
}

export interface ViewFrame {
  project(point: LatLng): FramePoint;
  /** Metres covered by one unit of the viewBox, so radii can be drawn to scale. */
  metresPerUnit: number;
  /** Bearing the frame was rotated by, in degrees. */
  upBearingDeg: number;
}

export interface BuildFrameInput {
  player: LatLng;
  target: LatLng;
  green: LatLng;
  /** Anything else that must stay inside the picture: green ring, centreline, hazards. */
  extra?: LatLng[];
  marginM?: number;
}

export function buildFrame(input: BuildFrameInput): ViewFrame {
  const { player, target, green } = input;
  const marginM = input.marginM ?? DEFAULT_MARGIN_M;
  const projection = localProjection(player);

  // Aim the frame at the target where there is one, otherwise at the green. On the green
  // the two coincide, so fall back to the hole's own direction rather than dividing by zero.
  const aim = bearingDeg(player, target);
  const upBearingDeg = Number.isFinite(aim) ? aim : bearingDeg(player, green);
  const radians = (upBearingDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  // Rotate metres so the aim runs along +y. North is +y before rotation, and bearings run
  // clockwise from north, so this is a clockwise rotation by the bearing.
  const rotate = (point: LatLng): FramePoint => {
    const { x, y } = projection.toXY(point);
    return { x: x * cos - y * sin, y: x * sin + y * cos };
  };

  const all = [player, target, green, ...(input.extra ?? [])].map(rotate);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of all) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  minX -= marginM;
  maxX += marginM;
  minY -= marginM;
  maxY += marginM;

  const widthM = Math.max(1, maxX - minX);
  const heightM = Math.max(1, maxY - minY);
  const metresPerUnit = Math.max(widthM / VIEW_WIDTH, heightM / VIEW_HEIGHT);

  // Centre the content in whichever axis has slack after preserving the aspect ratio.
  const centreX = (minX + maxX) / 2;
  const centreY = (minY + maxY) / 2;

  return {
    metresPerUnit,
    upBearingDeg,
    project: (point) => {
      const rotated = rotate(point);
      return {
        x: VIEW_WIDTH / 2 + (rotated.x - centreX) / metresPerUnit,
        // SVG y grows downward, so up-screen is a subtraction.
        y: VIEW_HEIGHT / 2 - (rotated.y - centreY) / metresPerUnit,
      };
    },
  };
}

/** Metres to viewBox units, for radii and stroke widths that must stay to scale. */
export function scaleM(frame: ViewFrame, metres: number): number {
  return metres / frame.metresPerUnit;
}
