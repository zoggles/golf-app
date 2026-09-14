import { describe, expect, it } from "vitest";
import { summaryInputSchema } from "./round-summary-payloads";

const INPUT = {
  course: "Arrowhead Golf Course & Marina",
  segment: "Full 18",
  playedOn: "2026-09-12",
  score: { total: 110, par: 67, toPar: "+43", holes: 18 },
  scoreMix: { Pars: 1, Bogeys: 6, Doubles: 3, "Triple+": 8 },
  wentWell: [],
  costYou: [],
  history: { previousRounds: 3, improving: [], slipping: [] },
};

describe("summaryInputSchema", () => {
  it("still accepts a request from an app build before the baseline existed", () => {
    expect(summaryInputSchema.safeParse(INPUT).success).toBe(true);
  });

  it("accepts the personal story", () => {
    const personal = {
      comparison: "4.2 strokes better than your Arrowhead average. Average 114.2 over your last 3 rounds here · Best 108",
      handicap: "Right on your handicap target (target 110)",
      ranks: ["Your best round at Arrowhead yet (4 played)"],
      trend: null,
      holesBetter: ["Hole 8: 4 today vs your avg 5.8 (-1.8 vs you)"],
      holesWorse: [],
      biggestOpportunity: "Fewer blow-up holes. 8 holes at triple bogey or worse cost 15 strokes more than double bogeys would have.",
    };
    expect(summaryInputSchema.parse({ ...INPUT, personal }).personal).toEqual(personal);
  });
});
