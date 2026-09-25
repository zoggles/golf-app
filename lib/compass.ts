"use client";

import { angleDeltaDeg, normalizeDeg } from "./geo";

/**
 * Which way the phone is pointing, from its compass.
 *
 * Android reports an absolute orientation (`deviceorientationabsolute`) with no prompt. iOS
 * reports `webkitCompassHeading` once the page has asked, which it may only do from a tap.
 * Either way the reading is magnetic, a few degrees off true north here; that is fine for an
 * arrow that says which way to walk, and it is never used for a yardage.
 */

/** How much of each new reading to take, so a shaking hand does not spin the arrow. */
const SMOOTHING = 0.25;
/** An arrow redrawn ten times a second looks live; more is battery for nothing. */
const EMIT_EVERY_MS = 100;
const MIN_CHANGE_DEG = 2;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Heading from the W3C orientation angles, clockwise from north.
 *
 * Held flat, the top of the screen is what points somewhere. Held up in front of you, the
 * top of the screen points at the sky and the back of the phone is what points ahead. Both
 * agree in between, and the two are at right angles so they can never both point up, so
 * whichever lies flatter along the ground is used. `screenAngleDeg` is how far the screen
 * has turned from portrait, since the top of a landscape screen is the side of the phone.
 */
export function headingFromOrientation(alpha: number, beta: number, gamma: number, screenAngleDeg = 0): number {
  const a = toRadians(alpha);
  const b = toRadians(beta);
  const g = toRadians(gamma);
  const s = toRadians(screenAngleDeg);
  // East and north components of the phone's right edge, its top edge, and the way its back faces.
  const right = {
    x: Math.cos(a) * Math.cos(g) - Math.sin(a) * Math.sin(b) * Math.sin(g),
    y: Math.sin(a) * Math.cos(g) + Math.cos(a) * Math.sin(b) * Math.sin(g),
  };
  const top = { x: -Math.sin(a) * Math.cos(b), y: Math.cos(a) * Math.cos(b) };
  const screenTop = { x: Math.sin(s) * right.x + Math.cos(s) * top.x, y: Math.sin(s) * right.y + Math.cos(s) * top.y };
  const back = {
    x: -Math.cos(a) * Math.sin(g) - Math.sin(a) * Math.sin(b) * Math.cos(g),
    y: -Math.sin(a) * Math.sin(g) + Math.cos(a) * Math.sin(b) * Math.cos(g),
  };
  const pointer = Math.hypot(screenTop.x, screenTop.y) >= Math.hypot(back.x, back.y) ? screenTop : back;
  return normalizeDeg((Math.atan2(pointer.x, pointer.y) * 180) / Math.PI);
}

interface CompassEvent extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
}

type PermissionRequest = () => Promise<"granted" | "denied">;

/**
 * Asks for the compass where the platform insists on asking. Call it from the tap that opens
 * the guide; iOS refuses the prompt from anywhere else. Everywhere else there is nothing to ask.
 */
export async function requestCompassAccess(): Promise<void> {
  if (typeof window === "undefined" || typeof DeviceOrientationEvent === "undefined") return;
  const request = (DeviceOrientationEvent as unknown as { requestPermission?: PermissionRequest }).requestPermission;
  if (typeof request !== "function") return;
  try {
    await request();
  } catch {
    // Refused or unavailable: the guide falls back to the way you are walking.
  }
}

function screenAngle(): number {
  const angle = window.screen?.orientation?.angle;
  return typeof angle === "number" ? angle : 0;
}

export function watchCompass(onHeading: (headingDeg: number) => void): () => void {
  if (typeof window === "undefined") return () => undefined;

  let x = 0;
  let y = 0;
  let primed = false;
  let lastEmitAt = 0;
  let lastSent: number | null = null;

  const take = (reading: number) => {
    const radians = toRadians(reading);
    // Averaged as a direction, not a number, so 359 and 1 average to north rather than south.
    if (primed) {
      x += (Math.sin(radians) - x) * SMOOTHING;
      y += (Math.cos(radians) - y) * SMOOTHING;
    } else {
      x = Math.sin(radians);
      y = Math.cos(radians);
      primed = true;
    }
    const now = Date.now();
    if (now - lastEmitAt < EMIT_EVERY_MS) return;
    const heading = normalizeDeg((Math.atan2(x, y) * 180) / Math.PI);
    if (lastSent !== null && Math.abs(angleDeltaDeg(lastSent, heading)) < MIN_CHANGE_DEG) return;
    lastEmitAt = now;
    lastSent = heading;
    onHeading(heading);
  };

  const read = (event: CompassEvent, absolute: boolean) => {
    // iOS measures from the top edge of the phone, whichever way the screen is turned.
    if (typeof event.webkitCompassHeading === "number" && Number.isFinite(event.webkitCompassHeading)) {
      take(normalizeDeg(event.webkitCompassHeading + screenAngle()));
      return;
    }
    if (!absolute || event.alpha === null || event.beta === null || event.gamma === null) return;
    take(headingFromOrientation(event.alpha, event.beta, event.gamma, screenAngle()));
  };

  // Android fires the absolute event; iOS carries its heading on the ordinary one. A plain
  // `deviceorientation` elsewhere is relative to wherever the phone started, which is no compass.
  const onAbsolute = (event: Event) => read(event as CompassEvent, true);
  const onRelative = (event: Event) => read(event as CompassEvent, (event as CompassEvent).absolute === true);
  const hasAbsolute = "ondeviceorientationabsolute" in window;

  if (hasAbsolute) window.addEventListener("deviceorientationabsolute", onAbsolute);
  else window.addEventListener("deviceorientation", onRelative);

  return () => {
    if (hasAbsolute) window.removeEventListener("deviceorientationabsolute", onAbsolute);
    else window.removeEventListener("deviceorientation", onRelative);
  };
}
