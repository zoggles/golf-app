import { describe, expect, it } from "vitest";
import {
  angleDeltaDeg,
  bearingDeg,
  destination,
  haversineM,
  localProjection,
  metresToYards,
  nearestPointOnPath,
  pathLengthM,
  pointAlongPath,
  pointInPolygon,
  polygonCentroid,
  polygonRadiusM,
  simplifyPath,
  yardsToMetres,
} from "./geo";

// A real tee and green from Durand Eastman hole 1, so the fixtures are not hand-waved.
const TEE = { lat: 43.235329, lng: -77.573316 };
const GREEN = { lat: 43.232408, lng: -77.571121 };

describe("distance", () => {
  it("measures a degree of latitude at the expected scale", () => {
    const metres = haversineM({ lat: 43, lng: -77 }, { lat: 44, lng: -77 });
    expect(metres).toBeGreaterThan(111_000);
    expect(metres).toBeLessThan(111_400);
  });

  it("returns zero for the same point", () => {
    expect(haversineM(TEE, TEE)).toBeCloseTo(0, 6);
  });

  it("round-trips yards and metres", () => {
    expect(metresToYards(yardsToMetres(371))).toBeCloseTo(371, 9);
  });
});

describe("bearing and destination", () => {
  it("reads the cardinal directions", () => {
    // East and west use a hole-scale step. Over a whole degree of longitude the initial
    // great-circle bearing genuinely curves poleward (89.66 at this latitude), which is
    // correct but not what anyone means by "due east".
    const origin = { lat: 43, lng: -77 };
    expect(bearingDeg(origin, { lat: 44, lng: -77 })).toBeCloseTo(0, 3);
    expect(bearingDeg(origin, { lat: 43, lng: -76.999 })).toBeCloseTo(90, 2);
    expect(bearingDeg(origin, { lat: 42, lng: -77 })).toBeCloseTo(180, 3);
    expect(bearingDeg(origin, { lat: 43, lng: -77.001 })).toBeCloseTo(270, 2);
  });

  it("lands exactly where it was aimed", () => {
    for (const bearing of [0, 45, 137, 268, 359]) {
      const landed = destination(TEE, bearing, 250);
      expect(haversineM(TEE, landed)).toBeCloseTo(250, 1);
      expect(bearingDeg(TEE, landed)).toBeCloseTo(bearing, 1);
    }
  });

  it("takes the short way round when comparing bearings", () => {
    expect(angleDeltaDeg(350, 10)).toBeCloseTo(20, 6);
    expect(angleDeltaDeg(10, 350)).toBeCloseTo(-20, 6);
  });
});

describe("localProjection", () => {
  it("round-trips a point back to itself", () => {
    const projection = localProjection(TEE);
    const back = projection.toLatLng(projection.toXY(GREEN));
    expect(back.lat).toBeCloseTo(GREEN.lat, 9);
    expect(back.lng).toBeCloseTo(GREEN.lng, 9);
  });

  it("agrees with haversine across a whole hole", () => {
    const projection = localProjection(TEE);
    const { x, y } = projection.toXY(GREEN);
    expect(Math.hypot(x, y)).toBeCloseTo(haversineM(TEE, GREEN), 1);
  });

  it("puts north up and east right", () => {
    const projection = localProjection(TEE);
    expect(projection.toXY({ lat: TEE.lat + 0.001, lng: TEE.lng }).y).toBeGreaterThan(0);
    expect(projection.toXY({ lat: TEE.lat, lng: TEE.lng + 0.001 }).x).toBeGreaterThan(0);
  });
});

describe("polygons", () => {
  const square = [
    { lat: 43.0, lng: -77.0 },
    { lat: 43.0, lng: -76.999 },
    { lat: 43.001, lng: -76.999 },
    { lat: 43.001, lng: -77.0 },
  ];

  it("finds the centre of a square", () => {
    const centre = polygonCentroid(square);
    expect(centre.lat).toBeCloseTo(43.0005, 6);
    expect(centre.lng).toBeCloseTo(-76.9995, 6);
  });

  it("falls back to the midpoint for a two-point ring", () => {
    const centre = polygonCentroid([square[0], square[2]]);
    expect(centre.lat).toBeCloseTo(43.0005, 9);
  });

  it("measures the radius out to the furthest corner", () => {
    const centre = polygonCentroid(square);
    const radius = polygonRadiusM(square, centre);
    expect(radius).toBeGreaterThan(haversineM(centre, { lat: 43.0005, lng: -77.0 }));
  });

  it("tells inside from outside", () => {
    expect(pointInPolygon({ lat: 43.0005, lng: -76.9995 }, square)).toBe(true);
    expect(pointInPolygon({ lat: 43.002, lng: -76.9995 }, square)).toBe(false);
  });
});

describe("paths", () => {
  const path = [TEE, { lat: 43.2338, lng: -77.5722 }, GREEN];

  it("sums the segments", () => {
    expect(pathLengthM(path)).toBeCloseTo(
      haversineM(path[0], path[1]) + haversineM(path[1], path[2]),
      6,
    );
  });

  it("clamps at both ends rather than extrapolating", () => {
    expect(pointAlongPath(path, -50)).toEqual(TEE);
    const past = pointAlongPath(path, pathLengthM(path) + 500);
    expect(haversineM(past, GREEN)).toBeCloseTo(0, 6);
  });

  it("walks the requested distance along the path", () => {
    const point = pointAlongPath(path, 100);
    expect(haversineM(TEE, point)).toBeCloseTo(100, 1);
  });

  it("reports how far off the line a point sits and how far along it is", () => {
    const onLine = pointAlongPath(path, 120);
    const strayed = destination(onLine, bearingDeg(TEE, GREEN) + 90, 30);
    const nearest = nearestPointOnPath(path, strayed);
    expect(nearest.distanceM).toBeCloseTo(30, 0);
    expect(nearest.alongM).toBeCloseTo(120, 0);
  });

  it("reports zero offset for a point already on the line", () => {
    expect(nearestPointOnPath(path, pointAlongPath(path, 200)).distanceM).toBeLessThan(0.5);
  });
});

describe("simplifyPath", () => {
  const noisy = Array.from({ length: 60 }, (_unused, index) => ({
    lat: 43 + index * 0.0001,
    lng: -77 + Math.sin(index) * 0.000002,
  }));

  it("leaves a short path alone", () => {
    expect(simplifyPath([TEE, GREEN], 24)).toHaveLength(2);
  });

  it("respects the cap and keeps both ends", () => {
    const simplified = simplifyPath(noisy, 12);
    expect(simplified.length).toBeLessThanOrEqual(12);
    expect(simplified[0]).toEqual(noisy[0]);
    expect(simplified[simplified.length - 1]).toEqual(noisy[noisy.length - 1]);
  });

  it("keeps a dogleg vertex that carries real shape", () => {
    const dogleg = [TEE, { lat: 43.2338, lng: -77.5722 }, GREEN];
    expect(simplifyPath(dogleg, 12)).toHaveLength(3);
  });
});
