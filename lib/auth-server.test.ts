import { describe, expect, it } from "vitest";
import { AuthenticationError, bearerToken } from "./auth-token";

describe("bearerToken", () => {
  it("returns a bearer token", () => {
    expect(bearerToken(new Request("https://example.test", { headers: { Authorization: "Bearer abc.123" } }))).toBe(
      "abc.123",
    );
  });

  it("rejects an uncredentialed request", () => {
    expect(() => bearerToken(new Request("https://example.test"))).toThrow(AuthenticationError);
  });
});
