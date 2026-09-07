import { describe, expect, it } from "vitest";
import { parseScoreCommand, parseScoreCommands, parseStartCommand } from "./voice-parser";
import { GENESEE_VALLEY_SOUTH } from "./courses";

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

  it("updates multiple past holes from one general instruction", () => {
    expect(parseScoreCommands("Change hole 3 to 5, and hole 4 was a bogey", GENESEE_VALLEY_SOUTH)).toEqual([
      { hole: 3, strokes: 5 },
      { hole: 4, strokes: 4 },
    ]);
  });
});
