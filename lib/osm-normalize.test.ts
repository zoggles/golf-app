import { describe, expect, it } from "vitest";
import { bearingDeg, destination, haversineM, metresToYards, yardsToMetres } from "./geo";
import type { LatLng } from "./hole-geometry";
import { DURAND_EASTMAN_ELEMENTS } from "./__fixtures__/durand-eastman";
import { assignHoles, normalizeOsmCourse, type ScorecardHole } from "./osm-normalize";
import type { OverpassElement } from "./overpass";

const ORIGIN: LatLng = { lat: 43.2328, lng: -77.5719 };

let nextId = 1;
const node = (point: LatLng) => ({ lat: point.lat, lon: point.lng });

/** A green as a rough circle of the given radius. */
function greenWay(centre: LatLng, radiusM = 12): OverpassElement {
  const ring = Array.from({ length: 12 }, (_unused, index) =>
    node(destination(centre, (index * 360) / 12, radiusM)),
  );
  return { type: "way", id: nextId++, tags: { golf: "green" }, geometry: [...ring, ring[0]] };
}

function holeWay(points: LatLng[], tags: Record<string, string> = {}): OverpassElement {
  return { type: "way", id: nextId++, tags: { golf: "hole", ...tags }, geometry: points.map(node) };
}

function hazardWay(centre: LatLng, radiusM: number, golf: string): OverpassElement {
  const ring = Array.from({ length: 10 }, (_unused, index) =>
    node(destination(centre, (index * 360) / 10, radiusM)),
  );
  return { type: "way", id: nextId++, tags: { golf }, geometry: [...ring, ring[0]] };
}

/** Lays out a straight hole of the given length on the given bearing. */
function straightHole(tee: LatLng, bearing: number, lengthM: number) {
  const greenCentre = destination(tee, bearing, lengthM);
  return { tee, greenCentre };
}

const card = (number: number, par: number, yards: number, handicap: number): ScorecardHole => ({
  number,
  par,
  yards,
  handicap,
});

describe("orientation", () => {
  it("normalises a reversed way to the same geometry", () => {
    const { tee, greenCentre } = straightHole(ORIGIN, 45, 340);
    const points = [tee, destination(tee, 45, 170), greenCentre];
    const green = greenWay(greenCentre);

    const forward = normalizeOsmCourse({
      elements: [green, holeWay(points, { ref: "1", par: "4" })],
      fix: ORIGIN,
      holes: [card(1, 4, 372, 5)],
    });
    const reversed = normalizeOsmCourse({
      elements: [green, holeWay([...points].reverse(), { ref: "1", par: "4" })],
      fix: ORIGIN,
      holes: [card(1, 4, 372, 5)],
    });

    const left = forward.geometry.holes[0];
    const right = reversed.geometry.holes[0];
    expect(haversineM(left.tee, right.tee)).toBeLessThan(0.5);
    expect(haversineM(left.greenCentre, right.greenCentre)).toBeLessThan(0.5);
    expect(left.lengthM).toBeCloseTo(right.lengthM, 3);
  });

  it("starts at the tee and ends at the green", () => {
    const { tee, greenCentre } = straightHole(ORIGIN, 10, 300);
    const result = normalizeOsmCourse({
      elements: [greenWay(greenCentre), holeWay([greenCentre, tee], { ref: "1" })],
      fix: ORIGIN,
      holes: [card(1, 4, 328, 1)],
    });
    const hole = result.geometry.holes[0];
    expect(haversineM(hole.centreline[0], tee)).toBeLessThan(0.5);
    expect(haversineM(hole.centreline[hole.centreline.length - 1], greenCentre)).toBeLessThan(13);
  });
});

describe("green edges", () => {
  it("puts the front nearer the tee than the back", () => {
    const { tee, greenCentre } = straightHole(ORIGIN, 120, 300);
    const result = normalizeOsmCourse({
      elements: [greenWay(greenCentre, 14), holeWay([tee, greenCentre], { ref: "1" })],
      fix: ORIGIN,
      holes: [card(1, 4, 328, 1)],
    });
    const hole = result.geometry.holes[0];
    expect(haversineM(tee, hole.greenFront)).toBeLessThan(haversineM(tee, hole.greenBack));
    const depth = haversineM(hole.greenFront, hole.greenBack);
    expect(depth).toBeGreaterThan(20);
    expect(depth).toBeLessThan(32);
  });

  it("keeps front and back fixed to the hole, not to where you stand", () => {
    // Standing behind the green must not swap the labels: they describe the hole.
    const { tee, greenCentre } = straightHole(ORIGIN, 0, 300);
    const result = normalizeOsmCourse({
      elements: [greenWay(greenCentre, 12), holeWay([tee, greenCentre], { ref: "1" })],
      fix: destination(greenCentre, 0, 60),
      holes: [card(1, 4, 328, 1)],
    });
    const hole = result.geometry.holes[0];
    expect(haversineM(tee, hole.greenFront)).toBeLessThan(haversineM(tee, hole.greenBack));
  });

  it("assumes a green when OSM mapped the hole but not the putting surface", () => {
    const { tee, greenCentre } = straightHole(ORIGIN, 200, 280);
    const result = normalizeOsmCourse({
      elements: [holeWay([tee, greenCentre], { ref: "1" })],
      fix: ORIGIN,
      holes: [card(1, 4, 306, 1)],
    });
    const hole = result.geometry.holes[0];
    expect(hole.greenPolygon).toBeNull();
    expect(haversineM(hole.greenCentre, greenCentre)).toBeLessThan(0.5);
    expect(haversineM(hole.greenFront, hole.greenBack)).toBeCloseTo(18, 0);
    expect(haversineM(tee, hole.greenFront)).toBeLessThan(haversineM(tee, hole.greenBack));
  });

  it("ignores a green that belongs to a different hole", () => {
    const { tee, greenCentre } = straightHole(ORIGIN, 90, 300);
    const strayGreen = greenWay(destination(greenCentre, 90, 400));
    const result = normalizeOsmCourse({
      elements: [strayGreen, holeWay([tee, greenCentre], { ref: "1" })],
      fix: ORIGIN,
      holes: [card(1, 4, 328, 1)],
    });
    expect(result.geometry.holes[0].greenPolygon).toBeNull();
  });
});

describe("hole assignment", () => {
  it("picks the candidate whose length matches the scorecard when refs collide", () => {
    const shortHole = straightHole(ORIGIN, 0, 145);
    const longHole = straightHole(destination(ORIGIN, 90, 500), 0, 310);
    const candidates = normalizeOsmCourse({
      elements: [
        greenWay(shortHole.greenCentre),
        greenWay(longHole.greenCentre),
        holeWay([shortHole.tee, shortHole.greenCentre], { ref: "3", par: "3" }),
        holeWay([longHole.tee, longHole.greenCentre], { ref: "3", par: "4" }),
      ],
      fix: ORIGIN,
      holes: [card(3, 4, 340, 6)],
    });

    const chosen = candidates.geometry.holes.find(
      (hole) => hole.osmId === candidates.holeMap[3],
    );
    expect(metresToYards(chosen!.lengthM)).toBeGreaterThan(300);
  });

  it("uses the walk from the previous green to choose between two loops", () => {
    // Both loops hold a hole of identical length and par. Only the walk distinguishes them.
    const nearTee = destination(ORIGIN, 0, 30);
    const farTee = destination(ORIGIN, 90, 1200);
    const near = straightHole(nearTee, 0, 300);
    const far = straightHole(farTee, 0, 300);

    const holes = [
      { osmId: "way/near", ref: "2", par: 4, handicap: 5, lengthM: 300, tee: near.tee, greenCentre: near.greenCentre, greenFront: near.greenCentre, greenBack: near.greenCentre, greenPolygon: null, centreline: [near.tee, near.greenCentre] },
      { osmId: "way/far", ref: "2", par: 4, handicap: 5, lengthM: 300, tee: far.tee, greenCentre: far.greenCentre, greenFront: far.greenCentre, greenBack: far.greenCentre, greenPolygon: null, centreline: [far.tee, far.greenCentre] },
      { osmId: "way/first", ref: "1", par: 4, handicap: 3, lengthM: 280, tee: ORIGIN, greenCentre: ORIGIN, greenFront: ORIGIN, greenBack: ORIGIN, greenPolygon: null, centreline: [ORIGIN, ORIGIN] },
    ];

    const map = assignHoles(holes, [card(1, 4, 306, 3), card(2, 4, 328, 5)]);
    expect(map[1]).toBe("way/first");
    expect(map[2]).toBe("way/near");
  });

  it("never assigns one geometry to two holes", () => {
    const first = straightHole(ORIGIN, 0, 300);
    const second = straightHole(destination(ORIGIN, 0, 320), 0, 300);
    const map = assignHoles(
      [
        { osmId: "way/a", ref: null, par: 4, handicap: 1, lengthM: 300, tee: first.tee, greenCentre: first.greenCentre, greenFront: first.greenCentre, greenBack: first.greenCentre, greenPolygon: null, centreline: [first.tee, first.greenCentre] },
        { osmId: "way/b", ref: null, par: 4, handicap: 2, lengthM: 300, tee: second.tee, greenCentre: second.greenCentre, greenFront: second.greenCentre, greenBack: second.greenCentre, greenPolygon: null, centreline: [second.tee, second.greenCentre] },
      ],
      [card(1, 4, 328, 1), card(2, 4, 328, 2)],
    );
    expect(map[1]).not.toBe(map[2]);
  });

  it("assigns an untagged hole by length and position", () => {
    const { tee, greenCentre } = straightHole(ORIGIN, 30, 160);
    const result = normalizeOsmCourse({
      elements: [greenWay(greenCentre), holeWay([tee, greenCentre], { par: "3" })],
      fix: ORIGIN,
      holes: [card(7, 3, 175, 17)],
    });
    expect(result.holeMap[7]).toBeDefined();
    expect(result.unmatched).toEqual([]);
  });

  it("reports scorecard holes that found nothing", () => {
    const { tee, greenCentre } = straightHole(ORIGIN, 0, 300);
    const result = normalizeOsmCourse({
      elements: [greenWay(greenCentre), holeWay([tee, greenCentre], { ref: "1" })],
      fix: ORIGIN,
      holes: [card(1, 4, 328, 1), card(2, 4, 400, 2)],
    });
    expect(result.holeMap[1]).toBeDefined();
    expect(result.unmatched).toEqual([2]);
  });
});

describe("hazards", () => {
  const { tee, greenCentre } = straightHole(ORIGIN, 0, 320);
  const hole = holeWay([tee, greenCentre], { ref: "1", par: "4" });

  it("stores bunkers as a circle and water as an outline", () => {
    const result = normalizeOsmCourse({
      elements: [
        greenWay(greenCentre),
        hole,
        hazardWay(destination(tee, 0, 200), 8, "bunker"),
        hazardWay(destination(tee, 0, 150), 25, "water_hazard"),
      ],
      fix: ORIGIN,
      holes: [card(1, 4, 350, 1)],
    });

    const bunker = result.geometry.hazards.find((item) => item.kind === "bunker");
    const water = result.geometry.hazards.find((item) => item.kind === "water");
    expect(bunker?.outline).toEqual([]);
    expect(bunker?.radiusM).toBeGreaterThan(6);
    expect(water?.outline.length).toBeGreaterThan(2);
    expect(water?.outline.length).toBeLessThanOrEqual(16);
  });

  it("drops hazards that are nowhere near the hole", () => {
    const result = normalizeOsmCourse({
      elements: [
        greenWay(greenCentre),
        hole,
        hazardWay(destination(tee, 90, 400), 10, "bunker"),
      ],
      fix: ORIGIN,
      holes: [card(1, 4, 350, 1)],
    });
    expect(result.geometry.hazards).toEqual([]);
  });

  it("ignores rough entirely", () => {
    const result = normalizeOsmCourse({
      elements: [greenWay(greenCentre), hole, hazardWay(destination(tee, 0, 160), 20, "rough")],
      fix: ORIGIN,
      holes: [card(1, 4, 350, 1)],
    });
    expect(result.geometry.hazards).toEqual([]);
  });
});

describe("course identity", () => {
  const { tee, greenCentre } = straightHole(ORIGIN, 0, 300);

  it("prefers the nearest golf course to the fix", () => {
    const near: OverpassElement = {
      type: "way",
      id: 111,
      tags: { leisure: "golf_course", name: "Near Links" },
      center: node(destination(ORIGIN, 0, 200)),
    };
    const far: OverpassElement = {
      type: "relation",
      id: 222,
      tags: { leisure: "golf_course", name: "Far Links" },
      center: node(destination(ORIGIN, 0, 2000)),
    };
    const result = normalizeOsmCourse({
      elements: [far, near, greenWay(greenCentre), holeWay([tee, greenCentre], { ref: "1" })],
      fix: ORIGIN,
      holes: [card(1, 4, 328, 1)],
    });
    expect(result.geometry.id).toBe("way/111");
    expect(result.geometry.name).toBe("Near Links");
  });

  it("falls back to the holes when no course polygon is mapped", () => {
    const result = normalizeOsmCourse({
      elements: [greenWay(greenCentre), holeWay([tee, greenCentre], { ref: "1" })],
      fix: ORIGIN,
      holes: [card(1, 4, 328, 1)],
    });
    expect(result.geometry.id).toMatch(/^holes\//);
    expect(result.geometry.attribution).toContain("OpenStreetMap");
  });

  it("returns an empty course rather than throwing when nothing is mapped", () => {
    const result = normalizeOsmCourse({ elements: [], fix: ORIGIN, holes: [card(1, 4, 328, 1)] });
    expect(result.geometry.holes).toEqual([]);
    expect(result.unmatched).toEqual([1]);
  });
});

describe("payload discipline", () => {
  it("caps centreline and green point counts", () => {
    const { tee } = straightHole(ORIGIN, 0, 400);
    const wiggly = Array.from({ length: 40 }, (_unused, index) =>
      destination(destination(tee, 0, index * 10), 90, Math.sin(index) * 6),
    );
    const greenCentre = wiggly[wiggly.length - 1];
    const bigGreen: OverpassElement = {
      type: "way",
      id: 900,
      tags: { golf: "green" },
      geometry: Array.from({ length: 60 }, (_unused, index) =>
        node(destination(greenCentre, (index * 360) / 60, 13)),
      ),
    };

    const result = normalizeOsmCourse({
      elements: [bigGreen, holeWay(wiggly, { ref: "1" })],
      fix: ORIGIN,
      holes: [card(1, 4, 437, 1)],
    });
    const hole = result.geometry.holes[0];
    expect(hole.centreline.length).toBeLessThanOrEqual(12);
    expect(hole.greenPolygon!.length).toBeLessThanOrEqual(24);
    // Simplifying must not distort the hole's length beyond a yard or two.
    expect(Math.abs(metresToYards(hole.lengthM) - metresToYards(yardsToMetres(437)))).toBeLessThan(25);
  });

  it("keeps the shot line pointing the right way after simplification", () => {
    const { tee, greenCentre } = straightHole(ORIGIN, 137, 350);
    const result = normalizeOsmCourse({
      elements: [greenWay(greenCentre), holeWay([tee, greenCentre], { ref: "1" })],
      fix: ORIGIN,
      holes: [card(1, 4, 383, 1)],
    });
    const hole = result.geometry.holes[0];
    expect(bearingDeg(hole.tee, hole.greenCentre)).toBeCloseTo(137, 0);
  });
});

describe("real Durand Eastman geometry", () => {
  // The White-tee scorecard as this app stores it. OSM hole ways start at the back tee, so
  // its distances run longer than the card; only the shape and the green are taken from OSM.
  const SCORECARD: ScorecardHole[] = [
    card(1, 4, 371, 13), card(2, 4, 405, 3), card(3, 4, 250, 15),
    card(4, 5, 451, 1), card(5, 3, 128, 17), card(6, 4, 300, 11),
    card(7, 4, 325, 7), card(8, 3, 170, 9), card(9, 4, 365, 5),
    card(10, 4, 398, 4), card(11, 4, 352, 8), card(12, 3, 155, 12),
    card(13, 4, 390, 2), card(14, 4, 315, 10), card(15, 4, 292, 14),
    card(16, 4, 225, 16), card(17, 3, 105, 18), card(18, 5, 467, 6),
  ];

  const result = normalizeOsmCourse({
    elements: DURAND_EASTMAN_ELEMENTS,
    fix: { lat: 43.232882, lng: -77.571926 },
    holes: SCORECARD,
  });

  it("resolves all eighteen holes", () => {
    expect(result.unmatched).toEqual([]);
    expect(result.geometry.holes).toHaveLength(18);
  });

  it("identifies the course from its polygon", () => {
    expect(result.geometry.id).toBe("way/134221139");
    expect(result.geometry.name).toBe("Durand Eastman Golf Course");
  });

  it("assigns each scorecard hole to the way OSM tagged with that number", () => {
    for (const hole of SCORECARD) {
      const geometry = result.geometry.holes.find((item) => item.osmId === result.holeMap[hole.number]);
      expect(geometry?.ref).toBe(String(hole.number));
      expect(geometry?.par).toBe(hole.par);
    }
  });

  it("derives green depths that match real greens", () => {
    for (const hole of SCORECARD) {
      const geometry = result.geometry.holes.find((item) => item.osmId === result.holeMap[hole.number])!;
      const front = haversineM(geometry.tee, geometry.greenFront);
      const centre = haversineM(geometry.tee, geometry.greenCentre);
      const back = haversineM(geometry.tee, geometry.greenBack);
      expect(front).toBeLessThan(centre);
      expect(centre).toBeLessThan(back);

      const depthYds = metresToYards(back - front);
      expect(depthYds).toBeGreaterThan(14);
      expect(depthYds).toBeLessThan(35);
    }
  });

  it("stays small enough to cache a whole course offline", () => {
    const bytes = JSON.stringify({ geometry: result.geometry, holeMap: result.holeMap }).length;
    expect(bytes).toBeLessThan(60 * 1024);
  });
});
