import { describe, expect, it } from "vitest";
import { DEFAULT_BAG, type Bag } from "./bag";
import { destination, haversineM, metresToYards, yardsToMetres } from "./geo";
import type { CourseHazard, LatLng, PlayingHoleGeometry } from "./hole-geometry";
import {
  classifyShot,
  detectHole,
  greenDistances,
  hazardsOnLine,
  isOnGreen,
  planShot,
} from "./shot-engine";

const TEE: LatLng = { lat: 43.2328, lng: -77.5719 };
const UP_THE_HOLE = 0;

/** A straight hole running due north, with a circular green at the far end. */
function hole(lengthYds: number, number = 1, greenRadiusM = 12): PlayingHoleGeometry {
  const lengthM = yardsToMetres(lengthYds);
  const greenCentre = destination(TEE, UP_THE_HOLE, lengthM);
  return {
    number,
    osmId: `way/${number}`,
    ref: String(number),
    par: 4,
    handicap: number,
    tee: TEE,
    greenCentre,
    greenFront: destination(greenCentre, 180, greenRadiusM),
    greenBack: destination(greenCentre, 0, greenRadiusM),
    greenPolygon: Array.from({ length: 12 }, (_unused, index) =>
      destination(greenCentre, (index * 360) / 12, greenRadiusM),
    ),
    centreline: [TEE, greenCentre],
    lengthM,
  };
}

/** A hazard centred on the hole line at the given carry. */
function hazardAt(carryYds: number, radiusM: number, kind: CourseHazard["kind"] = "water"): CourseHazard {
  const centre = destination(TEE, UP_THE_HOLE, yardsToMetres(carryYds));
  return { osmId: `way/hz-${carryYds}`, kind, outline: [], centre, radiusM };
}

/** A point the given number of yards up the hole from the tee. */
const upTheHole = (yards: number) => destination(TEE, UP_THE_HOLE, yardsToMetres(yards));

describe("greenDistances", () => {
  it("runs front, centre, back in order from the tee", () => {
    const distances = greenDistances(TEE, hole(380));
    expect(distances.frontYds).toBeLessThan(distances.centreYds);
    expect(distances.centreYds).toBeLessThan(distances.backYds);
  });

  it("keeps the labels fixed to the hole when you stand behind the green", () => {
    const target = hole(380);
    const behind = destination(target.greenBack, 0, 40);
    const distances = greenDistances(behind, target);
    // From back there the "front" really is further away. The labels describe the hole,
    // not the player, so front must still be the far number rather than silently swapping.
    expect(distances.frontYds).toBeGreaterThan(distances.backYds);
  });
});

describe("isOnGreen", () => {
  const target = hole(380);

  it("knows when the ball is on the putting surface", () => {
    expect(isOnGreen(target.greenCentre, target)).toBe(true);
    expect(isOnGreen(upTheHole(300), target)).toBe(false);
  });

  it("falls back to a radius when no polygon was mapped", () => {
    const unmapped = { ...target, greenPolygon: null };
    expect(isOnGreen(unmapped.greenCentre, unmapped)).toBe(true);
    expect(isOnGreen(destination(unmapped.greenCentre, 90, 40), unmapped)).toBe(false);
  });
});

describe("classifyShot", () => {
  const longest = 230;

  it("calls it a tee shot from the tee box", () => {
    expect(classifyShot(TEE, hole(400), longest).kind).toBe("tee");
  });

  it("calls it a layup when the green is out of reach", () => {
    expect(classifyShot(upTheHole(60), hole(480), longest).kind).toBe("layup");
  });

  it("calls it an approach once the green is reachable", () => {
    expect(classifyShot(upTheHole(230), hole(400), longest).kind).toBe("approach");
  });

  it("calls it short game inside forty yards", () => {
    expect(classifyShot(upTheHole(370), hole(400), longest).kind).toBe("short-game");
  });

  it("calls it a putt on the green", () => {
    const target = hole(400);
    expect(classifyShot(target.greenCentre, target, longest).kind).toBe("putt");
  });

  it("measures how far off the line you are", () => {
    const target = hole(400);
    const strayed = destination(upTheHole(200), 90, 30);
    const context = classifyShot(strayed, target, longest);
    expect(context.offCentrelineYds).toBeCloseTo(metresToYards(30), 0);
  });

  it("prefers putt over short game when both could apply", () => {
    const target = hole(400);
    expect(classifyShot(target.greenCentre, target, longest).kind).toBe("putt");
  });
});

describe("hazardsOnLine", () => {
  it("reports a hazard between the player and the target as a carry", () => {
    const water = hazardAt(150, 20);
    const carries = hazardsOnLine(TEE, upTheHole(230), [water]);
    expect(carries).toHaveLength(1);
    expect(carries[0].nearEdgeYds).toBeCloseTo(150 - metresToYards(20), 0);
    expect(carries[0].carried).toBe(true);
  });

  it("ignores a hazard well off the line", () => {
    const offLine = {
      ...hazardAt(150, 10),
      centre: destination(upTheHole(150), 90, 120),
    };
    expect(hazardsOnLine(TEE, upTheHole(230), [offLine])).toEqual([]);
  });

  it("ignores a hazard behind the player", () => {
    const behind = { ...hazardAt(150, 10), centre: destination(TEE, 180, 100) };
    expect(hazardsOnLine(TEE, upTheHole(230), [behind])).toEqual([]);
  });

  it("marks a hazard as not carried when the target stops short of it", () => {
    const carries = hazardsOnLine(TEE, upTheHole(120), [hazardAt(150, 20)]);
    expect(carries[0]?.carried).toBe(false);
  });

  it("orders several hazards by how far away they are", () => {
    const carries = hazardsOnLine(TEE, upTheHole(260), [hazardAt(200, 10), hazardAt(120, 10)]);
    expect(carries.map((carry) => Math.round(carry.nearEdgeYds))).toEqual(
      [...carries.map((carry) => Math.round(carry.nearEdgeYds))].sort((a, b) => a - b),
    );
  });
});

describe("planShot", () => {
  const base = { bag: DEFAULT_BAG, hazards: [] as CourseHazard[], accuracyM: 5 };

  it("takes driver off the tee on a long par four", () => {
    const plan = planShot({ ...base, from: TEE, hole: hole(380) });
    expect(plan.kind).toBe("tee");
    expect(plan.club?.club.id).toBe("driver");
    expect(plan.targetYds).toBeGreaterThan(180);
  });

  it("aims at the centre of the green on an approach and says so", () => {
    const target = hole(380);
    const plan = planShot({ ...base, from: upTheHole(230), hole: target });
    expect(plan.kind).toBe("approach");
    expect(haversineM(plan.target, target.greenCentre)).toBeLessThan(1);
    expect(plan.reason).toContain("green");
  });

  it("names no club for a putt", () => {
    const target = hole(380);
    const plan = planShot({ ...base, from: target.greenCentre, hole: target });
    expect(plan.kind).toBe("putt");
    expect(plan.club).toBeNull();
    expect(plan.onGreen).toBe(true);
  });

  it("never targets past the front of the green when laying up", () => {
    const target = hole(560);
    const plan = planShot({ ...base, from: TEE, hole: target });
    expect(plan.kind).toBe("tee");
    const targetFromTee = metresToYards(haversineM(TEE, plan.target));
    const frontFromTee = metresToYards(haversineM(TEE, target.greenFront));
    expect(targetFromTee).toBeLessThan(frontFromTee);
  });

  it("steps down to a club that stays short of water it cannot carry", () => {
    // Water from 200 to 240 with a 230 driver: the drive would finish in it.
    const water = hazardAt(220, yardsToMetres(20));
    const plan = planShot({ ...base, from: TEE, hole: hole(480), hazards: [water] });
    expect(plan.club!.club.carryYds).toBeLessThan(230);
    expect(plan.targetYds).toBeLessThan(200);
  });

  it("says it is laying up and flags the hazard as not carried", () => {
    const water = hazardAt(220, yardsToMetres(20));
    const plan = planShot({ ...base, from: TEE, hole: hole(480), hazards: [water] });
    expect(plan.laidUp).toBe(true);
    expect(plan.reason.toLowerCase()).toContain("lay up");
    expect(plan.carries.every((carry) => !carry.carried)).toBe(true);
  });

  it("keeps the full club when the hazard is comfortably carried", () => {
    const water = hazardAt(100, yardsToMetres(15));
    const plan = planShot({ ...base, from: TEE, hole: hole(420), hazards: [water] });
    expect(plan.club?.club.id).toBe("driver");
    expect(plan.carries[0]?.carried).toBe(true);
  });

  it("aims back to the fairway when badly off line", () => {
    const target = hole(420);
    const strayed = destination(upTheHole(180), 90, yardsToMetres(45));
    const plan = planShot({ ...base, from: strayed, hole: target });
    expect(plan.recovering).toBe(true);
  });

  it("points the shot at the target it chose", () => {
    const plan = planShot({ ...base, from: TEE, hole: hole(380) });
    expect(plan.bearingDeg).toBeCloseTo(0, 0);
  });

  it("survives an empty bag without inventing a club", () => {
    const plan = planShot({ ...base, bag: { clubs: [] } as Bag, from: TEE, hole: hole(380) });
    expect(plan.club).toBeNull();
  });
});

describe("dispersion", () => {
  const base = { bag: DEFAULT_BAG, hazards: [] as CourseHazard[] };

  it("widens as the GPS fix gets worse", () => {
    const sharp = planShot({ ...base, from: TEE, hole: hole(380), accuracyM: 4 });
    const vague = planShot({ ...base, from: TEE, hole: hole(380), accuracyM: 40 });
    expect(vague.dispersion.lateralYds).toBeGreaterThan(sharp.dispersion.lateralYds);
    expect(vague.dispersion.longYds).toBeGreaterThan(sharp.dispersion.longYds);
  });

  it("is tighter with a wedge than with a driver", () => {
    const drive = planShot({ ...base, from: TEE, hole: hole(380), accuracyM: 5 });
    const wedge = planShot({ ...base, from: upTheHole(300), hole: hole(380), accuracyM: 5 });
    expect(wedge.dispersion.lateralYds).toBeLessThan(drive.dispersion.lateralYds);
  });
});

describe("detectHole", () => {
  const first = hole(400, 1);
  const eleventh: PlayingHoleGeometry = {
    ...hole(400, 11),
    tee: destination(TEE, 90, 400),
    greenCentre: destination(destination(TEE, 90, 400), 0, yardsToMetres(400)),
    centreline: [destination(TEE, 90, 400), destination(destination(TEE, 90, 400), 0, yardsToMetres(400))],
  };

  it("recognises the hole you are standing on", () => {
    expect(detectHole(TEE, [first, eleventh], 7)).toBe(1);
    expect(detectHole(eleventh.tee, [first, eleventh], 7)).toBe(11);
  });

  it("keeps quiet when two fairways are equally close", () => {
    const parallel: PlayingHoleGeometry = {
      ...hole(400, 2),
      tee: destination(TEE, 90, 30),
      greenCentre: destination(destination(TEE, 90, 30), 0, yardsToMetres(400)),
      centreline: [destination(TEE, 90, 30), destination(destination(TEE, 90, 30), 0, yardsToMetres(400))],
    };
    const between = destination(TEE, 90, 15);
    expect(detectHole(between, [first, parallel], 5)).toBe(5);
  });

  it("keeps quiet when nothing is near", () => {
    expect(detectHole(destination(TEE, 90, 5000), [first, eleventh], 3)).toBe(3);
  });

  it("keeps quiet when there is no geometry at all", () => {
    expect(detectHole(TEE, [], 9)).toBe(9);
  });
});

describe("roll", () => {
  const base = { bag: DEFAULT_BAG, hazards: [] as CourseHazard[], accuracyM: 5 };

  it("runs further with a driver than with a wedge", () => {
    const drive = planShot({ ...base, from: TEE, hole: hole(400) });
    const wedge = planShot({ ...base, from: upTheHole(320), hole: hole(400) });
    expect(drive.rollYds).toBeGreaterThan(wedge.rollYds);
  });

  it("does not roll on the green or around it", () => {
    const target = hole(400);
    expect(planShot({ ...base, from: target.greenCentre, hole: target }).rollYds).toBe(0);
    expect(planShot({ ...base, from: upTheHole(375), hole: target }).rollYds).toBe(0);
  });

  it("stays a small fraction of the carry", () => {
    const drive = planShot({ ...base, from: TEE, hole: hole(400) });
    expect(drive.rollYds).toBeLessThan(drive.club!.club.carryYds * 0.15);
  });
});

describe("par 3 tee shots", () => {
  const base = { bag: DEFAULT_BAG, hazards: [] as CourseHazard[], accuracyM: 5 };

  it("plays at the green rather than laying up", () => {
    // Standing on a tee box does not make a reachable hole a positional shot. A 130 yard
    // par 3 wants a club that gets there, not a wedge that leaves 70 in.
    const plan = planShot({ ...base, from: TEE, hole: hole(130) });
    expect(plan.kind).toBe("approach");
    expect(plan.targetYds).toBeGreaterThan(120);
    expect(plan.club!.club.carryYds).toBeGreaterThan(110);
  });

  it("still treats an unreachable hole from the tee as a tee shot", () => {
    expect(planShot({ ...base, from: TEE, hole: hole(480) }).kind).toBe("tee");
  });

  it("plays at the green from the tee on a short par 4 it can reach", () => {
    const plan = planShot({ ...base, from: TEE, hole: hole(225) });
    expect(plan.kind).toBe("approach");
    expect(plan.targetYds).toBeGreaterThan(210);
  });
});
