import { describe, expect, it } from "vitest";
import { PIN_LENGTH, pinAccountEmail, pinAccountSlug, pinCredentialsSchema } from "./pin-auth";

describe("pin account identity", () => {
  it("matches one person however they capitalise or space their name", () => {
    expect(pinAccountSlug("Nate Zogby")).toBe("nate-zogby");
    expect(pinAccountSlug("  nate   zogby ")).toBe("nate-zogby");
    expect(pinAccountSlug("NATE ZOGBY")).toBe("nate-zogby");
  });

  it("strips accents and punctuation rather than encoding them", () => {
    expect(pinAccountSlug("Renée O'Neill")).toBe("renee-o-neill");
  });

  it("derives an address on a domain that can never receive mail", () => {
    expect(pinAccountEmail("Sam")).toBe("sam@pin.caddystack.invalid");
  });

  it("refuses a name with nothing to key on", () => {
    expect(() => pinAccountEmail("!!!")).toThrow(/at least one letter or number/);
  });
});

describe("pin credentials", () => {
  it("accepts a name and a full length numeric pin", () => {
    const parsed = pinCredentialsSchema.parse({ name: "  Sam  ", pin: "0".repeat(PIN_LENGTH) });
    expect(parsed).toEqual({ name: "Sam", pin: "0".repeat(PIN_LENGTH) });
  });

  it.each([["12345"], ["1234567"], ["12345a"], [""]])("rejects %s as a pin", (pin) => {
    expect(pinCredentialsSchema.safeParse({ name: "Sam", pin }).success).toBe(false);
  });

  it("rejects an empty name", () => {
    expect(pinCredentialsSchema.safeParse({ name: "   ", pin: "123456" }).success).toBe(false);
  });
});
