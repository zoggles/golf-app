import { describe, expect, it } from "vitest";
import { parseScoreCommand, parseStartCommand } from "./voice-parser";

describe("voice commands", () => {
  it("understands the requested Genesee Valley front nine", () => {
    expect(parseStartCommand("I'm playing the front 9 at Gennessee Valley Golf South Course")).toMatchObject({
      courseId: "genesee-valley-south",
      segment: "front9",
      understood: true,
    });
  });

  it("turns a spoken hole score into a structured update", () => {
    expect(parseScoreCommand("hole three, five strokes", "genesee-valley-south")).toEqual({ hole: 3, strokes: 5 });
  });

  it("understands common golf scoring language", () => {
    expect(parseScoreCommand("bogey on hole 4", "genesee-valley-south")).toEqual({ hole: 4, strokes: 4 });
  });
});
