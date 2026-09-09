import { describe, expect, it } from "vitest";
import { CADDY_STACK_API_ORIGIN, resolveApiUrl } from "./api-url";

describe("resolveApiUrl", () => {
  it("keeps browser requests on the current Vercel origin", () => {
    expect(resolveApiUrl("/api/games", false)).toBe("/api/games");
  });

  it("points installed-app requests at the Vercel backend", () => {
    expect(resolveApiUrl("/api/games?id=round-1", true)).toBe(
      `${CADDY_STACK_API_ORIGIN}/api/games?id=round-1`,
    );
  });
});
