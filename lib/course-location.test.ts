import { describe, expect, it } from "vitest";
import { locationTokens, normalizeLocation, phraseContradictsLocation } from "./course-location";

describe("normalizeLocation", () => {
  it("treats a state abbreviation and its full name as the same place", () => {
    expect(normalizeLocation("Rochester, NY")).toBe(normalizeLocation("Rochester, New York"));
    expect(normalizeLocation("Viera, FL")).toBe(normalizeLocation("Viera, Florida"));
  });

  it("ignores punctuation and case", () => {
    expect(normalizeLocation("  CHURCHVILLE,  new york ")).toBe("churchville new york");
  });

  it("leaves a place it does not recognise alone", () => {
    expect(normalizeLocation("St Andrews, Scotland")).toBe("st andrews scotland");
  });
});

describe("locationTokens", () => {
  it("keeps a two-word state together", () => {
    expect(locationTokens("Rochester, NY")).toEqual(["new york", "rochester"]);
  });

  it("does not split New York into new and york", () => {
    expect(locationTokens("Rochester, New York")).not.toContain("york");
  });

  it("drops repeats", () => {
    expect(locationTokens("Kansas City, Kansas")).toEqual(["kansas", "city"]);
  });
});

describe("phraseContradictsLocation", () => {
  const NAME = "Arrowhead Golf Club";
  const WHERE = "Littleton, CO";

  it("flags a phrase that names a different town", () => {
    // The reported bug: every Arrowhead in America answers to "arrowhead", so without
    // this the saved Littleton card is loaded for a course in New York.
    expect(
      phraseContradictsLocation(NAME, WHERE, "Arrowhead Golf Course & Marina, Spencerport NY"),
    ).toBe(true);
  });

  it("accepts a phrase that names the right town", () => {
    expect(phraseContradictsLocation(NAME, WHERE, "Arrowhead Golf Club, Littleton CO")).toBe(false);
  });

  it("accepts the right town given by its full state name", () => {
    expect(phraseContradictsLocation(NAME, WHERE, "Arrowhead in Littleton, Colorado")).toBe(false);
  });

  it("accepts the state alone", () => {
    expect(phraseContradictsLocation(NAME, WHERE, "Arrowhead Colorado")).toBe(false);
  });

  it("says nothing when the phrase names no place at all", () => {
    expect(phraseContradictsLocation(NAME, WHERE, "Arrowhead")).toBe(false);
    expect(phraseContradictsLocation(NAME, WHERE, "front nine at Arrowhead")).toBe(false);
  });

  it("does not mistake round or tee wording for a place", () => {
    for (const phrase of [
      "back nine at Arrowhead",
      "play 18 at Arrowhead today",
      "Arrowhead from the blue tees",
      "let's start the front 9 at Arrowhead this morning",
    ]) {
      expect(phraseContradictsLocation(NAME, WHERE, phrase)).toBe(false);
    }
  });

  it("does not mistake the course's own name for a place", () => {
    expect(
      phraseContradictsLocation("Durand Eastman Golf Course", "Rochester, NY", "Durand Eastman"),
    ).toBe(false);
  });

  it("accepts NY for a course stored as New York", () => {
    expect(
      phraseContradictsLocation("Durand Eastman Golf Course", "Rochester, New York", "Durand Eastman Rochester NY"),
    ).toBe(false);
  });

  it("flags a different city in the same state", () => {
    expect(
      phraseContradictsLocation("Durand Eastman Golf Course", "Rochester, New York", "Durand Eastman in Syracuse"),
    ).toBe(true);
  });
});
