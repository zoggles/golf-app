import { describe, expect, it } from "vitest";
import { extractTeeMention } from "./tee-selection";

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
});
