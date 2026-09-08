import { describe, expect, it } from "vitest";
import { GOLFER_HEADER, MissingGolferError, golferPayloadSchema, resolveGolferId } from "./golfers";

/**
 * The seam authentication will eventually replace. What matters is that a
 * request's identity comes from exactly one place, and that a bad claim is
 * refused rather than quietly scoping a query to nothing.
 */

const GOLFER = "11111111-1111-4111-8111-111111111111";

function request(headers: Record<string, string> = {}, body?: unknown): Request {
  return new Request("https://example.test/api/games", {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("resolveGolferId", () => {
  it("reads the golfer the request claims to be", () => {
    expect(resolveGolferId(request({ [GOLFER_HEADER]: GOLFER }))).toBe(GOLFER);
    expect(resolveGolferId(request({ [GOLFER_HEADER]: ` ${GOLFER} ` }))).toBe(GOLFER);
  });

  it("refuses a request that names no golfer", () => {
    expect(() => resolveGolferId(request())).toThrow(MissingGolferError);
    expect(() => resolveGolferId(request({ [GOLFER_HEADER]: "  " }))).toThrow(MissingGolferError);
  });

  it("refuses anything that is not a golfer id", () => {
    for (const claim of ["nell", "*", "1", "eq.null", `${GOLFER}&status=eq.active`]) {
      expect(() => resolveGolferId(request({ [GOLFER_HEADER]: claim }))).toThrow(MissingGolferError);
    }
  });

  it("ignores a golfer named in the body", () => {
    const withBody = request({ "Content-Type": "application/json" }, { golferId: GOLFER });
    expect(() => resolveGolferId(withBody)).toThrow(MissingGolferError);
  });
});

describe("golferPayloadSchema", () => {
  it("keeps a usable name and trims the padding off it", () => {
    expect(golferPayloadSchema.parse({ name: "  Nell Ray  " })).toEqual({ name: "Nell Ray" });
  });

  it("rejects a name that is blank or absurd", () => {
    expect(() => golferPayloadSchema.parse({ name: "   " })).toThrow();
    expect(() => golferPayloadSchema.parse({ name: "x".repeat(61) })).toThrow();
  });
});
