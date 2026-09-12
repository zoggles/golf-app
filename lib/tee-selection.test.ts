import { describe, expect, it } from "vitest";
import { courseListOptions, courseMatchesPhrase, extractTeeMention, samePhysicalCourse, teeDescription, teeOptionLabel } from "./tee-selection";
import { GENESEE_VALLEY_SOUTH } from "./courses";

describe("extractTeeMention", () => {
  it.each([
    ["Front nine from the red tees", "Red"],
    ["Playing Genesee Valley off the blue", "Blue"],
    ["Use the women's tees", "Forward"],
    ["I am using forward tees today", "Forward"],
  ])("reads %s", (phrase, tee) => {
    expect(extractTeeMention(phrase)).toBe(tee);
  });

  it("does not treat a color in a course name as a tee", () => {
    expect(extractTeeMention("Front nine at Blue Heron Golf Club")).toBeNull();
  });

  it("gives each common tee a compact player guide", () => {
    expect(teeDescription("Red")).toBe("Women");
    expect(teeDescription("Gold")).toBe("Seniors");
    expect(teeOptionLabel("Blue")).toBe("Blue — Advanced");
  });

  it("matches small speech-to-text and spelling differences in saved course names", () => {
    const skenandoa = {
      ...GENESEE_VALLEY_SOUTH,
      id: "skenandoa-white",
      name: "The Skenandoa Club",
      shortName: "Skenandoa",
      location: "Clinton, NY",
    };

    expect(courseMatchesPhrase(skenandoa, "Shenandoah, Clinton, New York, 18 holes")).toBe(true);
    expect(courseMatchesPhrase(skenandoa, "Shenendoa in Clinton for 18")).toBe(true);
    expect(courseMatchesPhrase(skenandoa, "Shenendoah at Turning Stone")).toBe(false);
  });

  it("shows each physical course once and prefers its white scorecard", () => {
    const red = { ...GENESEE_VALLEY_SOUTH, id: "genesee-red", tee: "Red" };
    const blue = { ...GENESEE_VALLEY_SOUTH, id: "genesee-blue", tee: "Blue" };
    expect(courseListOptions([red, blue, GENESEE_VALLEY_SOUTH])).toEqual([GENESEE_VALLEY_SOUTH]);
  });
});

describe("telling apart courses that share a name", () => {
  const arrowheadCO = {
    ...GENESEE_VALLEY_SOUTH,
    id: "arrowhead-golf-club-silver-fox",
    name: "Arrowhead Golf Club",
    shortName: "Arrowhead Golf Club",
    location: "Littleton, CO",
    tee: "Silver Fox",
  };

  it("does not answer for an Arrowhead in another state", () => {
    // Dropping "golf" and "club" leaves one distinguishing word, so without the location
    // check this saved Colorado card was loaded for a course in New York and there was no
    // way to reach the one actually wanted.
    expect(courseMatchesPhrase(arrowheadCO, "Arrowhead Golf Course & Marina, Spencerport NY")).toBe(false);
    expect(courseMatchesPhrase(arrowheadCO, "front 9 at Arrowhead in Spencerport New York")).toBe(false);
  });

  it("still answers for its own town, however the state is written", () => {
    expect(courseMatchesPhrase(arrowheadCO, "Arrowhead Golf Club, Littleton CO")).toBe(true);
    expect(courseMatchesPhrase(arrowheadCO, "Arrowhead in Littleton, Colorado")).toBe(true);
  });

  it("still answers when no location is given at all", () => {
    expect(courseMatchesPhrase(arrowheadCO, "Arrowhead")).toBe(true);
    expect(courseMatchesPhrase(arrowheadCO, "back nine at Arrowhead from the blue tees")).toBe(true);
  });
});

describe("samePhysicalCourse", () => {
  it("treats an abbreviated state and its full name as one place", () => {
    // Both spellings are in the live catalogue for this course, which was splitting its
    // Red and White cards into two separate entries in the picker.
    const abbreviated = { ...GENESEE_VALLEY_SOUTH, id: "gv-white", location: "Rochester, NY", tee: "White" };
    const spelledOut = { ...GENESEE_VALLEY_SOUTH, id: "gv-red", location: "Rochester, New York", tee: "Red" };
    expect(samePhysicalCourse(abbreviated, spelledOut)).toBe(true);
    expect(courseListOptions([spelledOut, abbreviated])).toHaveLength(1);
  });

  it("keeps genuinely different places apart", () => {
    const rochester = { ...GENESEE_VALLEY_SOUTH, location: "Rochester, NY" };
    const syracuse = { ...GENESEE_VALLEY_SOUTH, location: "Syracuse, NY" };
    expect(samePhysicalCourse(rochester, syracuse)).toBe(false);
  });
});
