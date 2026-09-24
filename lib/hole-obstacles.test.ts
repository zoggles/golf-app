import { describe, expect, it } from "vitest";
import { GENESEE_VALLEY_ELEMENTS, GENESEE_VALLEY_OUTLINES } from "./__fixtures__/genesee-valley";
import { GENESEE_VALLEY_COVER } from "./__fixtures__/genesee-valley-cover";
import { destination, nearestPointOnPath, yardsToMetres } from "./geo";
import { playingHole, type CourseHazard, type LatLng, type PlayingHoleGeometry, type TreeArea } from "./hole-geometry";
import { normalizeOsmCourse } from "./osm-normalize";
import { obstaclesAhead, obstaclesForShot, waterAdvice, type HoleObstacle } from "./hole-obstacles";

const TEE: LatLng = { lat: 43.11, lng: -77.65 };
const NORTH = 0;

/** A straight hole running north from the tee, measured in yards like a scorecard. */
function straightHole(lengthYds: number): PlayingHoleGeometry {
  const greenCentre = destination(TEE, NORTH, yardsToMetres(lengthYds));
  return {
    osmId: "way/1",
    number: 1,
    ref: "1",
    par: 4,
    handicap: 1,
    tee: TEE,
    greenCentre,
    greenFront: destination(greenCentre, 180, 12),
    greenBack: destination(greenCentre, 0, 12),
    greenPolygon: null,
    centreline: [TEE, greenCentre],
    lengthM: yardsToMetres(lengthYds),
  };
}

/** A rectangle, in yards: `from` and `to` along the hole, `left` and `right` of its line. */
function box(fromYds: number, toYds: number, leftYds: number, rightYds: number): LatLng[] {
  const at = (alongYds: number, acrossYds: number) =>
    destination(destination(TEE, NORTH, yardsToMetres(alongYds)), 90, yardsToMetres(acrossYds));
  return [at(fromYds, leftYds), at(toYds, leftYds), at(toYds, rightYds), at(fromYds, rightYds)];
}

function water(outline: LatLng[], id = "way/10"): CourseHazard {
  return { osmId: id, kind: "water", outline, centre: outline[0], radiusM: 1 };
}

function trees(outline: LatLng[], id: string): TreeArea {
  return { osmId: id, outline, centre: outline[0], radiusM: 1 };
}

describe("obstacles ahead", () => {
  const hole = straightHole(380);

  it("gives a pond across the fairway its reach and carry from the tee", () => {
    const [row] = obstaclesAhead({ from: TEE, hole, hazards: [water(box(150, 190, -40, 40))], trees: [] });
    expect(row.kind).toBe("water");
    expect(row.side).toBe("across");
    expect(row.reachYds).toBeCloseTo(150, 0);
    // The far corners inside the corridor sit a little wide of the line, so a touch past 190.
    expect(row.carryYds).toBeGreaterThanOrEqual(190);
    expect(row.carryYds).toBeLessThan(193);
  });

  it("puts trees off to the right on the right, and never across", () => {
    const [row] = obstaclesAhead({ from: TEE, hole, hazards: [], trees: [trees(box(180, 260, 20, 60), "way/20")] });
    expect(row.side).toBe("right");
    expect(row.reachYds).toBeGreaterThan(180);
    expect(row.reachYds).toBeLessThan(182);
    expect(row.carryYds).toBeGreaterThan(260);
    expect(row.carryYds).toBeLessThan(263);
  });

  it("puts water off to the left on the left", () => {
    const [row] = obstaclesAhead({ from: TEE, hole, hazards: [water(box(100, 140, -45, -18))], trees: [] });
    expect(row.side).toBe("left");
  });

  it("only measures the part of a wide wood that is inside the corridor", () => {
    // Runs from 10 to 200 yards right of the line; only its near edge is in play.
    const [row] = obstaclesAhead({ from: TEE, hole, hazards: [], trees: [trees(box(200, 240, 10, 200), "way/21")] });
    expect(row.carryYds).toBeLessThan(245);
  });

  it("leaves out anything wider than a wide miss", () => {
    const rows = obstaclesAhead({ from: TEE, hole, hazards: [water(box(150, 190, 45, 90))], trees: [] });
    expect(rows).toEqual([]);
  });

  it("leaves out what is behind the player", () => {
    const from = destination(TEE, NORTH, yardsToMetres(220));
    const rows = obstaclesAhead({ from, hole, hazards: [water(box(150, 190, -40, 40))], trees: [] });
    expect(rows).toEqual([]);
  });

  it("measures from where the player stands, not from the tee", () => {
    const from = destination(TEE, NORTH, yardsToMetres(100));
    const [row] = obstaclesAhead({ from, hole, hazards: [water(box(150, 190, -40, 40))], trees: [] });
    expect(row.reachYds).toBeCloseTo(50, 0);
  });

  it("calls a bunker beside the green greenside, and one in the fairway not", () => {
    const rows = obstaclesAhead({
      from: TEE,
      hole,
      hazards: [
        { osmId: "way/30", kind: "bunker", outline: box(372, 385, -22, -12), centre: TEE, radiusM: 1 },
        { osmId: "way/31", kind: "bunker", outline: box(230, 245, 8, 18), centre: TEE, radiusM: 1 },
      ],
      trees: [],
    });
    const greenside = rows.find((row) => row.key.startsWith("way/30#"));
    const fairway = rows.find((row) => row.key.startsWith("way/31#"));
    expect(greenside?.byGreen).toBe(true);
    expect(greenside?.side).toBe("left");
    expect(fairway?.byGreen).toBe(false);
    expect(fairway?.side).toBe("right");
  });

  it("still measures a bunker saved as a circle", () => {
    const centre = destination(destination(TEE, NORTH, yardsToMetres(240)), 90, yardsToMetres(15));
    const [row] = obstaclesAhead({
      from: TEE,
      hole,
      hazards: [{ osmId: "way/32", kind: "bunker", outline: [], centre, radiusM: 6 }],
      trees: [],
    });
    expect(row.side).toBe("right");
    expect(row.reachYds).toBeGreaterThan(232);
    expect(row.carryYds).toBeLessThan(250);
  });

  it("reads trees drawn in pieces down one side as one line of trees", () => {
    const rows = obstaclesAhead({
      from: TEE,
      hole,
      hazards: [],
      trees: [trees(box(100, 160, 18, 40), "way/40"), trees(box(170, 240, 18, 40), "way/41"), trees(box(120, 200, -40, -18), "way/42")],
    });
    expect(rows.filter((row) => row.side === "right")).toHaveLength(1);
    const right = rows.find((row) => row.side === "right")!;
    expect(right.reachYds).toBeLessThan(105);
    expect(right.carryYds).toBeGreaterThan(240);
    expect(rows.filter((row) => row.side === "left")).toHaveLength(1);
  });

  it("orders the list nearest first", () => {
    const rows = obstaclesAhead({
      from: TEE,
      hole,
      hazards: [water(box(250, 270, -40, 40), "way/50"), water(box(120, 140, -40, -20), "way/51")],
      trees: [],
    });
    expect(rows.map((row) => row.key.split("#")[0])).toEqual(["way/51", "way/50"]);
  });

  it("calls trees behind the green long, not across", () => {
    const [row] = obstaclesAhead({ from: TEE, hole, hazards: [], trees: [trees(box(392, 420, -30, 30), "way/61")] });
    expect(row.side).toBe("long");
    expect(row.byGreen).toBe(true);
  });

  it("splits one wood down the right and round behind the green into two rows", () => {
    // An L: a strip down the right from 150 yards, joined to a block behind the green.
    const at = (alongYds: number, acrossYds: number) =>
      destination(destination(TEE, NORTH, yardsToMetres(alongYds)), 90, yardsToMetres(acrossYds));
    const wood = [at(150, 20), at(392, 20), at(392, -30), at(420, -30), at(420, 50), at(150, 50)];
    const rows = obstaclesAhead({ from: TEE, hole, hazards: [], trees: [trees(wood, "way/62")] });
    expect(rows.map((row) => row.side).sort()).toEqual(["long", "right"]);
    const right = rows.find((row) => row.side === "right")!;
    expect(right.reachYds).toBeGreaterThan(150);
    expect(right.byGreen).toBe(false);
  });

  it("says nothing about the ground a player is standing in", () => {
    const from = destination(destination(TEE, NORTH, yardsToMetres(200)), 90, yardsToMetres(25));
    const rows = obstaclesAhead({ from, hole, hazards: [], trees: [trees(box(150, 260, 18, 40), "way/60")] });
    expect(rows).toEqual([]);
  });
});

describe("obstacles for this shot", () => {
  const row = (key: string, kind: HoleObstacle["kind"], side: HoleObstacle["side"], reachYds: number, carryYds: number): HoleObstacle =>
    ({ key, kind, side, byGreen: false, reachYds, carryYds });
  const drive = { targetYds: 230, longYds: 14, rollYds: 18 };

  it("keeps every water and bunker row ahead, whatever the shot", () => {
    const rows = [row("w", "water", "left", 60, 90), row("b", "bunker", "right", 380, 390)];
    expect(obstaclesForShot(rows, drive).map((item) => item.key)).toEqual(["w", "b"]);
  });

  it("keeps only the trees framing where this shot comes down, one a side", () => {
    const rows = [
      row("near", "trees", "left", 20, 60),
      row("landing-left", "trees", "left", 180, 300),
      row("landing-right", "trees", "right", 225, 260),
      row("second-right", "trees", "right", 240, 280),
      row("far", "trees", "right", 400, 450),
    ];
    expect(obstaclesForShot(rows, drive).map((item) => item.key)).toEqual(["landing-left", "landing-right"]);
  });

  it("keeps water over trees when there is not room for everything", () => {
    const rows = [
      row("t1", "trees", "left", 200, 260),
      row("t2", "trees", "right", 200, 260),
      row("w1", "water", "across", 300, 320),
      row("w2", "water", "left", 330, 350),
      row("b1", "bunker", "right", 390, 400),
    ];
    const kept = obstaclesForShot(rows, drive).map((item) => item.key);
    expect(kept).toHaveLength(4);
    expect(kept).toEqual(expect.arrayContaining(["w1", "w2", "b1"]));
  });
});

describe("water advice", () => {
  const shot = (targetYds: number, hazards: CourseHazard[]) =>
    waterAdvice({
      from: TEE,
      target: destination(TEE, NORTH, yardsToMetres(targetYds)),
      targetYds,
      rollYds: 12,
      dispersion: { lateralYds: 16, longYds: 12 },
      hazards,
    });

  it("gives the carry when the shot flies over water", () => {
    expect(shot(230, [water(box(150, 190, -40, 40))])).toBe("Water crosses your line: 190 to carry it.");
  });

  it("warns about water just past the target", () => {
    expect(shot(200, [water(box(215, 250, -40, 40))])).toBe("Water past your target at 215.");
  });

  it("warns about water beside the landing area", () => {
    expect(shot(230, [water(box(215, 250, 12, 60))])).toBe("Water right of your landing area.");
    expect(shot(230, [water(box(215, 250, -60, -12))])).toBe("Water left of your landing area.");
  });

  it("stays quiet about water well away from the shot", () => {
    expect(shot(230, [water(box(215, 250, 45, 90))])).toBeNull();
    expect(shot(150, [water(box(260, 300, -40, 40))])).toBeNull();
  });

  it("never gives advice about bunkers", () => {
    expect(
      shot(230, [{ osmId: "way/70", kind: "bunker", outline: box(150, 190, -40, 40), centre: TEE, radiusM: 1 }]),
    ).toBeNull();
  });
});

describe("real Genesee Valley obstacles", () => {
  // White cards from the county scorecard. North is tomorrow's course; South is the home course.
  const NORTH = [[1,5,492,1],[2,4,287,15],[3,4,330,13],[4,3,146,17],[5,5,456,5],[6,3,217,9],[7,4,398,3],[8,4,393,7],[9,3,197,11],[10,4,413,6],[11,4,348,12],[12,3,164,16],[13,5,467,2],[14,4,408,8],[15,5,500,4],[16,4,410,10],[17,4,310,14],[18,3,150,18]];
  const SOUTH = [[1,4,370,5],[2,4,333,15],[3,3,222,7],[4,3,180,11],[5,4,251,17],[6,4,371,1],[7,4,338,9],[8,4,325,13],[9,4,435,3],[10,4,305,6],[11,3,110,18],[12,4,290,16],[13,3,153,8],[14,3,157,10],[15,4,385,2],[16,4,315,12],[17,4,305,14],[18,4,385,4]];

  const course = (name: "north" | "south", card: number[][], fix: LatLng) => {
    const holes = card.map(([number, par, yards, handicap]) => ({ number, par, yards, handicap }));
    const result = normalizeOsmCourse({
      elements: [...GENESEE_VALLEY_ELEMENTS, ...GENESEE_VALLEY_OUTLINES, ...GENESEE_VALLEY_COVER],
      fix,
      holes,
      courseName: `genesee valley golf course ${name}`,
    });
    const bundle = { courseKey: name, geometry: result.geometry, holeMap: result.holeMap, matchedBy: "gps" as const };
    const fromTee = (number: number) => {
      const hole = playingHole(bundle, number)!;
      return obstaclesAhead({ from: hole.tee, hole, hazards: result.geometry.hazards, trees: result.geometry.trees ?? [] });
    };
    return { geometry: result.geometry, fromTee };
  };
  const north = course("north", NORTH, { lat: 43.1144, lng: -77.6517 });
  const south = course("south", SOUTH, { lat: 43.11186, lng: -77.65463 });

  it("keeps the ponds and the bunker checked against imagery", () => {
    const ids = north.geometry.hazards.map((hazard) => hazard.osmId);
    expect(ids).toEqual(expect.arrayContaining(["way/702333090", "way/702333091", "way/754320964"]));
    // Tagged only as a pond, which is why South never had it before.
    expect(south.geometry.hazards.map((hazard) => hazard.osmId)).toContain("way/702333097");
  });

  it("puts the pond on North 4 on the right, early", () => {
    const water = north.fromTee(4).find((row) => row.kind === "water")!;
    expect(water.side).toBe("right");
    expect(water.reachYds).toBeGreaterThan(40);
    expect(water.carryYds).toBeLessThan(100);
  });

  it("puts the bunker on North 18 right of the green", () => {
    const bunker = north.fromTee(18).find((row) => row.kind === "bunker")!;
    expect(bunker.side).toBe("right");
    expect(bunker.byGreen).toBe(true);
    expect(bunker.reachYds).toBeGreaterThan(130);
    expect(bunker.carryYds).toBeLessThan(160);
  });

  it("lines the right of North 12 with the trees along the canal", () => {
    expect(north.fromTee(12).some((row) => row.kind === "trees" && row.side === "right")).toBe(true);
  });

  it("puts the pond on South 1 on the left, as one pond", () => {
    // It bends more than a wide miss away from the line halfway along, and back again.
    const water = south.fromTee(1).filter((row) => row.kind === "water");
    expect(water).toHaveLength(1);
    expect(water[0].side).toBe("left");
    expect(water[0].reachYds).toBeLessThan(65);
    expect(water[0].carryYds).toBeGreaterThan(185);
  });

  it("never reports trees across a North fairway", () => {
    for (let number = 1; number <= 18; number += 1) {
      expect(north.fromTee(number).filter((row) => row.kind === "trees" && row.side === "across")).toEqual([]);
    }
  });

  it("keeps every outline within a few metres of what was mapped", () => {
    const mapped = new Map(GENESEE_VALLEY_COVER.map((element) => [`way/${element.id}`, element.geometry ?? []]));
    const kept = [...north.geometry.hazards, ...(north.geometry.trees ?? [])].filter((item) => mapped.has(item.osmId));
    expect(kept.length).toBeGreaterThan(20);
    for (const item of kept) {
      const ring = [...item.outline, item.outline[0]];
      for (const vertex of mapped.get(item.osmId)!) {
        expect(nearestPointOnPath(ring, { lat: vertex.lat, lng: vertex.lon }).distanceM).toBeLessThan(3.1);
      }
    }
  });
});
