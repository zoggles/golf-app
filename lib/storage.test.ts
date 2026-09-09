import { beforeAll, describe, expect, it } from "vitest";
import { GENESEE_VALLEY_SOUTH } from "./courses";

/**
 * Exercises the persistence layer against a fake browser and a fake API, with
 * the network dropping mid-round the way it does on a real course, and with two
 * account-scoped local mirrors.
 */

interface GameRecord extends Record<string, unknown> {
  golferId: string;
}

interface FakeApi {
  games: Map<string, GameRecord>;
  courses: Map<string, Record<string, unknown>>;
  setOnline: (value: boolean) => void;
  goOnline: () => void;
}

const NELL = { id: "11111111-1111-4111-8111-111111111111", name: "Nell" };
const RAY = { id: "22222222-2222-4222-8222-222222222222", name: "Ray" };

let api: FakeApi;
let storage: typeof import("./storage");
let session: typeof import("./golfer-session");

function installFakeBrowser(): FakeApi {
  const store = new Map<string, string>();
  const listeners = new Map<string, Array<() => void>>();
  const globals = globalThis as unknown as Record<string, unknown>;

  globals.window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
    addEventListener: (type: string, handler: () => void) =>
      void listeners.set(type, [...(listeners.get(type) ?? []), handler]),
    removeEventListener: () => undefined,
    dispatchEvent: (event: { type: string }) => (listeners.get(event.type) ?? []).forEach((handler) => handler()),
  };
  globals.document = { visibilityState: "visible", addEventListener: () => undefined };
  globals.Event = class {
    type: string;
    constructor(type: string) {
      this.type = type;
    }
  };
  Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, writable: true, configurable: true });

  const games = new Map<string, GameRecord>();
  const courses = new Map<string, Record<string, unknown>>();
  let online = true;

  const respond = (value: unknown, status = 200) => ({
    ok: status < 400,
    status,
    json: async () => value,
    text: async () => JSON.stringify(value),
  });

  globals.fetch = async (
    url: string,
    init: { method?: string; body?: string; headers?: Record<string, string> } = {},
  ) => {
    if (!online) throw new Error("offline");
    const [path, query] = String(url).split("?");
    const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    // Mirrors the server: identity is derived from the authenticated session,
    // never from an owner id in the request body.
    const golferId = session?.readSelectedGolfer()?.id ?? "";

    if (path === "/api/golf-data") {
      if (!golferId) return respond({ error: "no golfer" }, 400);
      const rounds = [...games.values()]
        .filter((item) => item.golferId === golferId)
        .sort((left, right) => (String(left.startedAt) < String(right.startedAt) ? 1 : -1));
      return respond({
        version: 2,
        activeRoundId: rounds.find((item) => item.status === "active")?.id ?? null,
        rounds,
        courses: [...courses.values()],
      });
    }
    if (path === "/api/courses" && init.method === "POST" && body) {
      courses.set(String(body.id), body);
      return respond({ course: body });
    }
    if (path === "/api/games" && init.method === "POST" && body) {
      if (!golferId) return respond({ error: "no golfer" }, 400);
      // Mirrors the foreign key: a game cannot land before its course.
      if (!courses.has(String(body.courseId))) return respond({ error: "missing course" }, 422);
      games.set(String(body.id), { ...body, golferId });
      return respond({ game: body });
    }
    if (path === "/api/games" && init.method === "DELETE") {
      const gameId = new URLSearchParams(query).get("id") ?? "";
      // A delete only reaches the caller's own game.
      if (games.get(gameId)?.golferId === golferId) games.delete(gameId);
      return respond({ ok: true });
    }
    return respond({ error: "not found" }, 404);
  };

  return {
    games,
    courses,
    setOnline: (value: boolean) => void (online = value),
    goOnline: () => {
      online = true;
      (listeners.get("online") ?? []).forEach((handler) => handler());
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

beforeAll(async () => {
  api = installFakeBrowser();
  storage = await import("./storage");
  session = await import("./golfer-session");
  storage.subscribeToGolfData(() => undefined);
  session.selectGolfer(NELL);
  await settle();
});

describe("golf persistence", () => {
  it("stores a round in the database and keeps playing through a dead zone", async () => {
    const round = storage.startRound(GENESEE_VALLEY_SOUTH, "front9", "start the front nine");
    await settle();

    expect(api.courses.has(GENESEE_VALLEY_SOUTH.id)).toBe(true);
    expect(api.games.get(round.id)?.golferId).toBe(NELL.id);
    expect(storage.readGolfData().activeRoundId).toBe(round.id);

    // Scores logged while an earlier write is still in flight must not be lost.
    for (let hole = 1; hole <= 5; hole += 1) storage.updateRoundScore(round.id, hole, 4, "voice");
    storage.updateRoundHoleMetrics(round.id, 1, { putts: 2, fairway: "hit", penaltyStrokes: 0 }, "voice", "two putts, fairway hit");
    await settle();
    expect(Object.keys(api.games.get(round.id)?.scores as object)).toHaveLength(5);
    expect(api.games.get(round.id)?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ hole: 1, metrics: { putts: 2, fairway: "hit", penaltyStrokes: 0 } }),
    ]));

    api.setOnline(false);
    for (let hole = 6; hole <= 9; hole += 1) storage.updateRoundScore(round.id, hole, 5, "manual");
    storage.completeRound(round.id);
    await settle();

    expect(Object.keys(storage.readGolfData().rounds[0].scores)).toHaveLength(9);
    expect(storage.readGolfData().rounds[0].status).toBe("completed");
    expect(Object.keys(api.games.get(round.id)?.scores as object)).toHaveLength(5);

    api.goOnline();
    await settle();
    await settle();

    expect(Object.keys(api.games.get(round.id)?.scores as object)).toHaveLength(9);
    expect(api.games.get(round.id)?.status).toBe("completed");
    expect(storage.readGolfData().activeRoundId).toBeNull();

    storage.deleteRound(round.id);
    await settle();
    expect(api.games.has(round.id)).toBe(false);
    expect(api.courses.has(GENESEE_VALLEY_SOUTH.id)).toBe(true);
  });

  it("keeps each golfer's rounds to themselves", async () => {
    const nellRound = storage.startRound(GENESEE_VALLEY_SOUTH, "front9");
    await settle();

    session.selectGolfer(RAY);
    await settle();
    // Switching shows Ray's history, not a leftover view of Nell's.
    expect(storage.readGolfData().rounds).toHaveLength(0);
    expect(storage.readGolfData().activeRoundId).toBeNull();

    const rayRound = storage.startRound(GENESEE_VALLEY_SOUTH, "back9");
    await settle();
    expect(storage.readGolfData().rounds.map((item) => item.id)).toEqual([rayRound.id]);
    expect(api.games.get(rayRound.id)?.golferId).toBe(RAY.id);

    session.selectGolfer(NELL);
    await settle();
    expect(storage.readGolfData().rounds.map((item) => item.id)).toEqual([nellRound.id]);

    storage.deleteRound(nellRound.id);
    session.selectGolfer(RAY);
    await settle();
    storage.deleteRound(rayRound.id);
    await settle();
    expect(api.games.size).toBe(0);
  });

  it("does not drain one account's offline write under another account", async () => {
    session.selectGolfer(RAY);
    await settle();

    api.setOnline(false);
    const rayRound = storage.startRound(GENESEE_VALLEY_SOUTH, "front9");
    storage.updateRoundScore(rayRound.id, 1, 6, "manual");
    await settle();
    expect(api.games.has(rayRound.id)).toBe(false);

    // Nell picks up the phone before Ray's round has reached the database.
    session.selectGolfer(NELL);
    api.goOnline();
    await settle();
    await settle();

    expect(api.games.has(rayRound.id)).toBe(false);
    expect(storage.readGolfData().rounds).toHaveLength(0);

    session.selectGolfer(RAY);
    await settle();
    await settle();
    expect(api.games.get(rayRound.id)?.golferId).toBe(RAY.id);
    expect(Object.keys(api.games.get(rayRound.id)?.scores as object)).toHaveLength(1);
  });
});
