import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CourseGeometryBundle, OsmHoleGeometry } from "./hole-geometry";

vi.mock("./api-url", () => ({ apiUrl: (path: string) => path }));
vi.mock("./auth-client", () => ({ authHeaders: () => ({}) }));

const KEY = "genesee valley golf course south|rochester ny";
const POINT = { lat: 43.11, lng: -77.65 };
const CARD = Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, yards: 350, handicap: index + 1 }));

function hole(number: number): OsmHoleGeometry {
  return {
    osmId: `way/${number}`,
    ref: String(number),
    par: 4,
    handicap: number,
    tee: POINT,
    greenCentre: POINT,
    greenFront: POINT,
    greenBack: POINT,
    greenPolygon: null,
    centreline: [POINT, POINT],
    lengthM: 320,
  };
}

/** A course copy that can draw the given number of holes. */
function bundle(mapped: number): CourseGeometryBundle {
  const holes = Array.from({ length: mapped }, (_, index) => hole(index + 1));
  return {
    courseKey: KEY,
    geometry: {
      id: mapped ? "way/617520258" : `manual/${KEY}`,
      name: "",
      centre: POINT,
      holes,
      hazards: [],
      trees: [],
      source: mapped ? "osm" : "manual",
      attribution: "© OpenStreetMap contributors",
      fetchedAt: "2026-09-14T12:00:00.000Z",
    },
    holeMap: Object.fromEntries(holes.map((item, index) => [index + 1, item.osmId])),
    matchedBy: mapped ? "gps" : "manual",
  };
}

function withObstacles(copy: CourseGeometryBundle): CourseGeometryBundle {
  const wood = { osmId: "way/9", outline: [POINT, POINT, POINT], centre: POINT, radiusM: 10 };
  return { ...copy, geometry: { ...copy.geometry, trees: [wood] } };
}

function reply(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);
}

let storage: Map<string, string>;
let fetchMock: ReturnType<typeof vi.fn>;

/** A fresh copy of the cache module, as a new app session would load it. */
async function session() {
  vi.resetModules();
  return import("./course-geometry-cache");
}

beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    },
  });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mappedHoleCount", () => {
  it("counts only holes the copy can actually draw", async () => {
    const { mappedHoleCount } = await session();
    const partial = bundle(18);
    partial.geometry.holes = partial.geometry.holes.slice(0, 16);
    expect(mappedHoleCount(partial)).toBe(16);
    expect(mappedHoleCount(bundle(0))).toBe(0);
    expect(mappedHoleCount(null)).toBe(0);
  });
});

describe("ensureCourseGeometry", () => {
  it("gives an empty saved copy a second look and replaces it with the full map", async () => {
    storage.set(`caddy-stack:geometry:v1:${KEY}`, JSON.stringify(bundle(0)));
    fetchMock.mockReturnValue(reply({ bundle: bundle(18) }));
    const cache = await session();
    expect(cache.readGeometryState(KEY).status).toBe("unmapped");

    await cache.ensureCourseGeometry({ courseKey: KEY, holes: CARD, fix: POINT });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cache.readGeometryState(KEY).status).toBe("ready");
    expect(cache.mappedHoleCount(JSON.parse(storage.get(`caddy-stack:geometry:v1:${KEY}`) ?? "null"))).toBe(18);

    // Complete now, so every later fix is served from the phone.
    await cache.ensureCourseGeometry({ courseKey: KEY, holes: CARD, fix: POINT });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("looks again only once a session, and keeps the copy it has when that fails", async () => {
    storage.set(`caddy-stack:geometry:v1:${KEY}`, JSON.stringify(bundle(16)));
    fetchMock.mockReturnValue(Promise.reject(new Error("offline")));
    const cache = await session();

    await cache.ensureCourseGeometry({ courseKey: KEY, holes: CARD, fix: POINT });
    await cache.ensureCourseGeometry({ courseKey: KEY, holes: CARD, fix: POINT });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cache.readGeometryState(KEY)).toMatchObject({ status: "ready" });
    expect(cache.mappedHoleCount(cache.readGeometryState(KEY).bundle)).toBe(16);
  });

  it("never swaps a copy for one that knows fewer holes", async () => {
    storage.set(`caddy-stack:geometry:v1:${KEY}`, JSON.stringify(bundle(16)));
    fetchMock.mockReturnValue(reply({ bundle: bundle(0) }));
    const cache = await session();

    await cache.ensureCourseGeometry({ courseKey: KEY, holes: CARD, fix: POINT });

    expect(cache.mappedHoleCount(cache.readGeometryState(KEY).bundle)).toBe(16);
  });
});

describe("refreshCourseGeometry", () => {
  it("downloads the map ahead of play with no position", async () => {
    fetchMock.mockReturnValue(reply({ bundle: bundle(18) }));
    const cache = await session();

    await cache.refreshCourseGeometry(KEY, 18);

    expect(fetchMock).toHaveBeenCalledWith(`/api/course-geometry?courseKey=${encodeURIComponent(KEY)}`, expect.anything());
    expect(cache.readGeometryState(KEY).status).toBe("ready");
    expect(storage.has(`caddy-stack:geometry:v1:${KEY}`)).toBe(true);
  });

  it("leaves a complete copy alone", async () => {
    storage.set(`caddy-stack:geometry:v1:${KEY}`, JSON.stringify(bundle(18)));
    const cache = await session();

    await cache.refreshCourseGeometry(KEY, 18);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("heals an empty copy saved from somewhere else", async () => {
    storage.set(`caddy-stack:geometry:v1:${KEY}`, JSON.stringify(bundle(0)));
    fetchMock.mockReturnValue(reply({ bundle: bundle(18) }));
    const cache = await session();

    await cache.refreshCourseGeometry(KEY, 18);

    expect(cache.readGeometryState(KEY).status).toBe("ready");
  });

  it("upgrades a complete copy saved before water and trees were read", async () => {
    const before = bundle(18);
    delete before.geometry.trees;
    storage.set(`caddy-stack:geometry:v1:${KEY}`, JSON.stringify(before));
    fetchMock.mockReturnValue(reply({ bundle: withObstacles(bundle(18)) }));
    const cache = await session();

    await cache.refreshCourseGeometry(KEY, 18);

    expect(cache.readGeometryState(KEY).bundle?.geometry.trees).toHaveLength(1);
  });

  it("keeps a copy saved before obstacles when the server has nothing better", async () => {
    const before = bundle(18);
    delete before.geometry.trees;
    storage.set(`caddy-stack:geometry:v1:${KEY}`, JSON.stringify(before));
    fetchMock.mockReturnValue(reply({ bundle: bundle(16) }));
    const cache = await session();

    await cache.refreshCourseGeometry(KEY, 18);

    expect(cache.mappedHoleCount(cache.readGeometryState(KEY).bundle)).toBe(18);
  });

  it("keeps what it has when offline", async () => {
    storage.set(`caddy-stack:geometry:v1:${KEY}`, JSON.stringify(bundle(0)));
    fetchMock.mockReturnValue(Promise.reject(new Error("offline")));
    const cache = await session();

    await expect(cache.refreshCourseGeometry(KEY, 18)).resolves.toBeUndefined();

    expect(cache.readGeometryState(KEY).status).toBe("unmapped");
  });
});
