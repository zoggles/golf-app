import { describe, expect, it } from "vitest";
import { golferPayloadSchema } from "./golfers";

describe("golferPayloadSchema", () => {
  it("keeps a usable name and trims the padding off it", () => {
    expect(golferPayloadSchema.parse({ name: "  Nell Ray  " })).toEqual({ name: "Nell Ray" });
  });

  it("rejects a name that is blank or too long", () => {
    expect(() => golferPayloadSchema.parse({ name: "   " })).toThrow();
    expect(() => golferPayloadSchema.parse({ name: "x".repeat(61) })).toThrow();
  });
});
