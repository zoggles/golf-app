import { describe, expect, it } from "vitest";
import { headingFromOrientation } from "./compass";

const heading = (alpha: number, beta: number, gamma: number, screenAngle = 0) =>
  Math.round(headingFromOrientation(alpha, beta, gamma, screenAngle)) % 360;

describe("headingFromOrientation", () => {
  it("reads the top edge of a phone lying flat", () => {
    expect(heading(0, 0, 0)).toBe(0);
    // Alpha turns anticlockwise, so a quarter turn left points the top edge west.
    expect(heading(90, 0, 0)).toBe(270);
    expect(heading(270, 0, 0)).toBe(90);
  });

  it("reads the back of a phone held upright in front of you", () => {
    expect(heading(0, 90, 0)).toBe(0);
    expect(heading(90, 90, 0)).toBe(270);
  });

  it("agrees between flat and upright, the way a phone is really held", () => {
    expect(heading(30, 45, 0)).toBe(330);
    expect(heading(30, 70, 0)).toBe(330);
  });

  it("reads the top of a landscape screen, which is the side of the phone", () => {
    // Turned a quarter anticlockwise with its top edge north, the screen's top faces east.
    expect(heading(0, 0, 0, 90)).toBe(90);
    expect(heading(0, 0, 0, 270)).toBe(270);
  });

  it("ignores which way the screen is turned once the phone is held up", () => {
    // Stood on its left edge with the back facing north: the top of the screen points at the sky.
    expect(heading(90, 0, -90, 90)).toBe(0);
  });
});
