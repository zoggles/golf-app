import { describe, expect, it } from "vitest";
import { courseListOptions, courseMatchesPhrase, extractTeeMention, teeDescription, teeOptionLabel } from "./tee-selection";
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
