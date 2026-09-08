import { beforeAll, describe, expect, it } from "vitest";
import { GENESEE_VALLEY_SOUTH } from "./courses";

/**
 * Exercises the persistence layer against a fake browser and a fake API, with
 * the network dropping mid-round the way it does on a real course.
 */

interface FakeApi {
  games: Map<string, Record<string, unknown>>;
  courses: Map<string, Record<string, unknown>>;
  setOnline: (value: boolean) => void;
  goOnline: () => void;
}

let api: FakeApi;
let storage: typeof import("./storage");

function installFakeBrowser(): FakeApi {
  const store = new Map<string, string>();
  const listeners = new Map<string, Array<() => void>>();
  const globals = globalThis as unknown as Record<string, unknown>;

  globals.window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
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

  const games = new Map<string, Record<string, unknown>>();
  const courses = new Map<string, Record<string, unknown>>();
  let online = true;

  const respond = (value: unknown, status = 200) => ({
    ok: status < 400,
    status,
    json: async () => value,
    text: async () => JSON.stringify(value),
  });

  globals.fetch = async (url: string, init: { method?: string; body?: string } = {}) => {
    if (!online) throw new Error("offline");
    const [path, query] = String(url).split("?");
    const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;

    if (path === "/api/golf-data") {
      const rounds = [...games.values()].sort((left, right) =>
        String(left.startedAt) < String(right.startedAt) ? 1 : -1,
      );
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
      // Mirrors the foreign key: a game cannot land before its course.
      if (!courses.has(String(body.courseId))) return respond({ error: "missing course" }, 422);
      games.set(String(body.id), body);
      return respond({ game: body });
    }
    if (path === "/api/games" && init.method === "DELETE") {
      games.delete(new URLSearchParams(query).get("id") ?? "");
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
  storage.subscribeToGolfData(() => undefined);
  await settle();
});

describe("golf persistence", () => {
  it("stores a round in the database and keeps playing through a dead zone", async () => {
    const round = storage.startRound(GENESEE_VALLEY_SOUTH, "front9", "start the front nine");
    await settle();

    expect(api.courses.has(GENESEE_VALLEY_SOUTH.id)).toBe(true);
    expect(api.games.has(round.id)).toBe(true);
    expect(storage.readGolfData().activeRoundId).toBe(round.id);

    // Scores logged while an earlier write is still in flight must not be lost.
    for (let hole = 1; hole <= 5; hole += 1) storage.updateRoundScore(round.id, hole, 4, "voice");
    await settle();
    expect(Object.keys(api.games.get(round.id)?.scores as object)).toHaveLength(5);

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
});
