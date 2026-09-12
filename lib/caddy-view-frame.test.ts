import { describe, expect, it } from "vitest";
import { buildFrame, scaleM, VIEW_HEIGHT, VIEW_WIDTH } from "./caddy-view-frame";
import { destination, yardsToMetres } from "./geo";
import type { LatLng } from "./hole-geometry";

const PLAYER: LatLng = { lat: 43.2328, lng: -77.5719 };

/** A green the given distance away on the given bearing. */
const greenAt = (bearing: number, yards: number) => destination(PLAYER, bearing, yardsToMetres(yards));

describe("buildFrame", () => {
  it("puts the shot line straight up the screen, whichever way the hole runs", () => {
    for (const bearing of [0, 47, 123, 200, 315]) {
      const green = greenAt(bearing, 180);
      const frame = buildFrame({ player: PLAYER, target: green, green });
      const from = frame.project(PLAYER);
      const to = frame.project(green);

      expect(to.y).toBeLessThan(from.y);
      expect(Math.abs(to.x - from.x)).toBeLessThan(1);
    }
  });

  it("keeps every point it was given inside the viewBox", () => {
    const green = greenAt(30, 200);
    const extra = [
      destination(green, 90, 20),
      destination(green, 270, 20),
      destination(PLAYER, 120, 60),
    ];
    const frame = buildFrame({ player: PLAYER, target: green, green, extra });

    for (const point of [PLAYER, green, ...extra]) {
      const projected = frame.project(point);
      expect(projected.x).toBeGreaterThanOrEqual(0);
      expect(projected.x).toBeLessThanOrEqual(VIEW_WIDTH);
      expect(projected.y).toBeGreaterThanOrEqual(0);
      expect(projected.y).toBeLessThanOrEqual(VIEW_HEIGHT);
    }
  });

  it("tightens as the player walks up the hole", () => {
    const green = greenAt(0, 400);
    const scales = [0, 120, 260, 360].map((walked) => {
      const player = destination(PLAYER, 0, yardsToMetres(walked));
      return buildFrame({ player, target: green, green }).metresPerUnit;
    });

    for (let index = 1; index < scales.length; index += 1) {
      expect(scales[index]).toBeLessThan(scales[index - 1]);
    }
  });

  it("scales metres to units consistently", () => {
    const green = greenAt(0, 200);
    const frame = buildFrame({ player: PLAYER, target: green, green });
    expect(scaleM(frame, frame.metresPerUnit)).toBeCloseTo(1, 9);
    expect(scaleM(frame, 0)).toBe(0);
  });

  it("stays sane when the target is where the player already is", () => {
    // Standing on the green: player, target and green all coincide.
    const frame = buildFrame({ player: PLAYER, target: PLAYER, green: PLAYER });
    const projected = frame.project(PLAYER);
    expect(Number.isFinite(projected.x)).toBe(true);
    expect(Number.isFinite(projected.y)).toBe(true);
    expect(frame.metresPerUnit).toBeGreaterThan(0);
  });

  it("respects a wider margin by zooming out", () => {
    const green = greenAt(0, 200);
    const tight = buildFrame({ player: PLAYER, target: green, green, marginM: 10 });
    const loose = buildFrame({ player: PLAYER, target: green, green, marginM: 80 });
    expect(loose.metresPerUnit).toBeGreaterThan(tight.metresPerUnit);
  });

  it("reports the bearing it rotated by", () => {
    const green = greenAt(137, 180);
    expect(buildFrame({ player: PLAYER, target: green, green }).upBearingDeg).toBeCloseTo(137, 0);
  });

  it("puts a point left of the shot line on the left of the screen", () => {
    const green = greenAt(0, 200);
    const left = destination(destination(PLAYER, 0, 100), 270, 30);
    const frame = buildFrame({ player: PLAYER, target: green, green, extra: [left] });
    expect(frame.project(left).x).toBeLessThan(frame.project(PLAYER).x);
  });
});
