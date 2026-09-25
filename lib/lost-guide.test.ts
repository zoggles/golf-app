import { describe, expect, it } from "vitest";
import { GENESEE_VALLEY_ELEMENTS, GENESEE_VALLEY_OUTLINES } from "./__fixtures__/genesee-valley";
import { GENESEE_VALLEY_COVER } from "./__fixtures__/genesee-valley-cover";
import { destination, haversineM, metresToYards, yardsToMetres } from "./geo";
import { playingHoles, type CourseHazard, type LatLng, type PlayingHoleGeometry } from "./hole-geometry";
import {
  ARRIVED_M,
  compassWord,
  distanceToTeeBoxM,
  greenNearTee,
  guideToHole,
  hasArrived,
  LEFT_AGAIN_M,
  ordinal,
  playingTee,
  turnToward,
  waterOnTheWay,
  whereYouAre,
  whereaboutsText,
} from "./lost-guide";
import { normalizeOsmCourse } from "./osm-normalize";

const TEE: LatLng = { lat: 43.2328, lng: -77.5719 };

/** A straight hole running due north from a back tee, with a round green at the far end. */
function hole(number: number, lengthYds: number, start: LatLng = TEE): PlayingHoleGeometry {
  const greenCentre = destination(start, 0, yardsToMetres(lengthYds));
  return {
    number,
    osmId: `way/${number}`,
    ref: String(number),
    par: 4,
    handicap: number,
    tee: start,
    greenCentre,
    greenFront: destination(greenCentre, 180, 12),
    greenBack: destination(greenCentre, 0, 12),
    greenPolygon: Array.from({ length: 12 }, (_unused, index) => destination(greenCentre, (index * 360) / 12, 12)),
    centreline: [start, greenCentre],
    lengthM: yardsToMetres(lengthYds),
  };
}

/** A point this many yards up the hole and this many to its right. */
const at = (upYds: number, rightYds = 0) =>
  destination(destination(TEE, 0, yardsToMetres(upYds)), 90, yardsToMetres(rightYds));

function pond(outline: LatLng[], kind: CourseHazard["kind"] = "water"): CourseHazard {
  return { osmId: "way/pond", kind, outline, centre: outline[0], radiusM: 1 };
}

describe("playingTee", () => {
  it("steps up the hole to the tee on the scorecard", () => {
    const tee = playingTee(hole(1, 400), 360);
    expect(metresToYards(tee.alongM)).toBeCloseTo(40, 0);
    expect(metresToYards(haversineM(TEE, tee.point))).toBeCloseTo(40, 0);
  });

  it("stays on the back tee when the scorecard is as long as the map, or longer", () => {
    expect(playingTee(hole(1, 400), 400).alongM).toBeCloseTo(0, 3);
    expect(playingTee(hole(1, 400), 430).alongM).toBe(0);
  });

  it("stays on the back tee when the scorecard has no yardage", () => {
    expect(playingTee(hole(1, 400), 0).alongM).toBe(0);
  });

  it("stays on the back tee when the map and the card disagree beyond any forward tee", () => {
    // 250 yards short of the map is not a forward tee, it is a different idea of the hole.
    expect(playingTee(hole(1, 450), 200).alongM).toBe(0);
  });
});

describe("distanceToTeeBoxM", () => {
  const target = hole(1, 400);
  const tee = playingTee(target, 360);

  it("counts anywhere between the back tee and the tee being played as there", () => {
    expect(distanceToTeeBoxM(at(20), target, tee)).toBeLessThan(1);
    expect(distanceToTeeBoxM(at(20, 10), target, tee)).toBeCloseTo(yardsToMetres(10), 0);
  });

  it("measures from behind the back tee", () => {
    expect(distanceToTeeBoxM(at(-15), target, tee)).toBeCloseTo(yardsToMetres(15), 0);
  });

  it("does not count standing beside the fairway further up as being at the tee", () => {
    expect(distanceToTeeBoxM(at(200, 10), target, tee)).toBeGreaterThan(yardsToMetres(150));
  });
});

describe("hasArrived", () => {
  it("needs to be close to arrive, and a good deal further to leave again", () => {
    expect(hasArrived(ARRIVED_M - 1, false)).toBe(true);
    expect(hasArrived(ARRIVED_M + 10, false)).toBe(false);
    expect(hasArrived(ARRIVED_M + 10, true)).toBe(true);
    expect(hasArrived(LEFT_AGAIN_M + 1, true)).toBe(false);
  });
});

describe("turnToward", () => {
  it("says which way to turn from the way you face", () => {
    expect(turnToward(0, 10).turn).toBe("ahead");
    expect(turnToward(0, 45).turn).toBe("bear-right");
    expect(turnToward(0, -45).turn).toBe("bear-left");
    expect(turnToward(90, 0).turn).toBe("left");
    expect(turnToward(0, 100).turn).toBe("right");
    expect(turnToward(0, 180).turn).toBe("behind");
  });

  it("turns the short way across north", () => {
    expect(turnToward(350, 10)).toEqual({ relativeDeg: 20, turn: "ahead" });
    expect(turnToward(10, 330).turn).toBe("bear-left");
  });
});

describe("words", () => {
  it("names the nearest of eight compass points", () => {
    expect(compassWord(0)).toBe("north");
    expect(compassWord(44)).toBe("northeast");
    expect(compassWord(200)).toBe("south");
    expect(compassWord(350)).toBe("north");
    expect(compassWord(-90)).toBe("west");
  });

  it("writes hole ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 18, 21, 22].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "18th", "21st", "22nd",
    ]);
  });
});

describe("waterOnTheWay", () => {
  const square = (upFrom: number, upTo: number, left: number, right: number) => [
    at(upFrom, left),
    at(upTo, left),
    at(upTo, right),
    at(upFrom, right),
  ];

  it("sees a pond across the straight walk", () => {
    expect(waterOnTheWay(TEE, at(200), [pond(square(80, 120, -30, 30))])).toBe(true);
  });

  it("ignores a pond beside the walk", () => {
    expect(waterOnTheWay(TEE, at(200), [pond(square(80, 120, 20, 60))])).toBe(false);
  });

  it("ignores a pond beyond where you are going", () => {
    expect(waterOnTheWay(TEE, at(200), [pond(square(220, 260, -30, 30))])).toBe(false);
  });

  it("walks through bunkers without a word", () => {
    expect(waterOnTheWay(TEE, at(200), [pond(square(80, 120, -30, 30), "bunker")])).toBe(false);
  });

  it("judges water saved without its outline by its circle", () => {
    const circle: CourseHazard = { osmId: "way/old", kind: "water", outline: [], centre: at(100, 5), radiusM: 20 };
    expect(waterOnTheWay(TEE, at(200), [circle])).toBe(true);
    expect(waterOnTheWay(TEE, at(200), [{ ...circle, centre: at(100, 60) }])).toBe(false);
  });
});

describe("whereYouAre", () => {
  const first = hole(1, 400);
  const beside = hole(2, 400, at(0, 70));

  it("names the hole whose fairway you are on", () => {
    expect(whereYouAre(at(200, -5), [first, beside])).toEqual({ number: 1, part: "fairway" });
  });

  it("names a green you are standing on", () => {
    expect(whereYouAre(first.greenCentre, [first, beside])).toEqual({ number: 1, part: "green" });
  });

  it("says nothing between two fairways, where a guess could send you the wrong way", () => {
    expect(whereYouAre(at(200, 35), [first, beside])).toBeNull();
  });

  it("says nothing when no hole is near", () => {
    expect(whereYouAre(at(200, -300), [first, beside])).toBeNull();
  });

  it("reads naturally", () => {
    expect(whereaboutsText({ number: 8, part: "green" })).toBe("You're by the 8th green.");
    expect(whereaboutsText({ number: 1, part: "tee" })).toBe("You're on the 1st tee.");
    expect(whereaboutsText({ number: 12, part: "fairway" })).toBe("You're on hole 12.");
  });
});

describe("greenNearTee", () => {
  it("points to a green right beside the tee, but never the hole's own", () => {
    const first = hole(1, 400);
    const second = hole(2, 350, destination(first.greenCentre, 90, 40));
    expect(greenNearTee(second.tee, 2, [first, second])).toBe(1);
    expect(greenNearTee(first.tee, 1, [first, second])).toBeNull();
  });
});

describe("lost on Genesee Valley North", () => {
  // White card from the county scorecard.
  const CARD = [[1,5,492,1],[2,4,287,15],[3,4,330,13],[4,3,146,17],[5,5,456,5],[6,3,217,9],[7,4,398,3],[8,4,393,7],[9,3,197,11],[10,4,413,6],[11,4,348,12],[12,3,164,16],[13,5,467,2],[14,4,408,8],[15,5,500,4],[16,4,410,10],[17,4,310,14],[18,3,150,18]];
  const result = normalizeOsmCourse({
    elements: [...GENESEE_VALLEY_ELEMENTS, ...GENESEE_VALLEY_OUTLINES, ...GENESEE_VALLEY_COVER],
    fix: { lat: 43.1144, lng: -77.6517 },
    holes: CARD.map(([number, par, yards, handicap]) => ({ number, par, yards, handicap })),
    courseName: "genesee valley golf course north",
  });
  const holes = playingHoles({ courseKey: "north", geometry: result.geometry, holeMap: result.holeMap, matchedBy: "gps" });
  const numbered = (number: number) => holes.find((item) => item.number === number)!;
  const guide = (from: LatLng) =>
    guideToHole({ from, hole: numbered(4), yards: 146, holes, hazards: result.geometry.hazards });

  it("has the 4th and 8th tees on either side of the 3rd green, which is how you end up on 8", () => {
    const third = numbered(3).greenCentre;
    expect(metresToYards(haversineM(third, playingTee(numbered(4), 146).point))).toBeLessThan(100);
    expect(metresToYards(haversineM(third, numbered(8).tee))).toBeLessThan(60);
  });

  it("leads back from the 8th green to the 4th tee", () => {
    const guidance = guide(numbered(8).greenCentre);
    expect(guidance.here).toEqual({ number: 8, part: "green" });
    expect(guidance.teeByGreen).toBe(3);
    expect(compassWord(guidance.bearingDeg)).toBe("south");
    expect(guidance.distanceYds).toBeGreaterThan(450);
    expect(guidance.distanceYds).toBeLessThan(560);
    // The ponds by holes 2 to 4, checked against imagery, sit across the straight walk.
    expect(guidance.waterOnTheWay).toBe(true);
    expect(hasArrived(guidance.teeBoxM, false)).toBe(false);
  });

  it("arrives on the 4th tee, and not a green away from it", () => {
    const onTee = guide(playingTee(numbered(4), 146).point);
    expect(hasArrived(onTee.teeBoxM, false)).toBe(true);
    const onThirdGreen = guide(numbered(3).greenCentre);
    expect(hasArrived(onThirdGreen.teeBoxM, false)).toBe(false);
  });

  it("counts every North hole's back tee as its tee box, wherever the white tee sits", () => {
    for (const [number, , yards] of CARD) {
      const target = numbered(number);
      expect(hasArrived(distanceToTeeBoxM(target.tee, target, playingTee(target, yards)), false)).toBe(true);
    }
  });
});
