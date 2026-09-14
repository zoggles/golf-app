import { readFileSync } from "node:fs";
import { generateText, Output } from "ai";
import { beforeAll, describe, expect, it } from "vitest";
import type { SummaryInput } from "./round-report";
import { roundSummarySchema } from "./round-summary-payloads";
import { ROUND_SUMMARY_MODEL, ROUND_SUMMARY_SYSTEM, roundSummaryPrompt } from "./round-summary-prompt";

/**
 * Live check of the AI caddy's post-round take, against the real model through the gateway.
 *
 * Skipped by default: it spends a model call and needs gateway credentials, neither of which
 * belongs in `npm test`. Run it when the prompt changes, with:
 *
 *     CADDY_E2E=1 npx vitest run lib/round-summary.e2e.test.ts
 */

beforeAll(() => {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
});

async function writeTake(input: SummaryInput) {
  const result = await generateText({
    model: ROUND_SUMMARY_MODEL,
    maxRetries: 1,
    maxOutputTokens: 700,
    providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } },
    output: Output.object({ schema: roundSummarySchema }),
    system: ROUND_SUMMARY_SYSTEM,
    prompt: roundSummaryPrompt(input),
  });
  return result.output;
}

const WITH_HISTORY: SummaryInput = {
  course: "Arrowhead Golf Course & Marina",
  segment: "Full 18",
  playedOn: "2026-09-12",
  score: { total: 78, par: 67, toPar: "+11", holes: 18 },
  scoreMix: { Eagles: 0, Birdies: 2, Pars: 7, Bogeys: 5, Doubles: 2, "Triple+": 1 },
  wentWell: [
    "7 straight holes at par or better (5–11)",
    "2 birdies on holes 7 and 11",
    "Hit 7 of 13 fairways (54%)",
    "4 one-putts",
  ],
  costYou: [
    "3 doubles or worse on holes 2, 12 and 16, +8 on those holes alone",
    "Hole 12: 8 on a par 4",
    "2 penalty strokes handed away",
    "2 three-putts on holes 4 and 12",
  ],
  history: {
    previousRounds: 3,
    improving: [
      "Score against par: +11 per 18 now vs +16.3 per 18 before",
      "Holes at par or better: 44% now vs 22% before",
    ],
    slipping: ["Penalty strokes: 0.11 now vs 0.00 before"],
  },
  personal: {
    comparison: "4.2 strokes better than your Arrowhead average. Average 82.2 over your last 3 rounds here · Best 79",
    handicap: "5 strokes under your handicap target (target 83)",
    ranks: ["Your best round at Arrowhead yet (4 played)"],
    trend: "Trending better: about 6 strokes lower across your last four 18-hole rounds.",
    holesBetter: ["Hole 7: 2 today vs your avg 3.8 (-1.8 vs you)"],
    holesWorse: ["Hole 12: 8 today vs your avg 5.4 (+2.6 vs you)"],
    biggestOpportunity: "Keep the ball in play. 2 penalty strokes on hole 12.",
  },
};

const FIRST_ROUND: SummaryInput = {
  ...WITH_HISTORY,
  history: { previousRounds: 0, improving: [], slipping: [] },
  personal: {
    comparison: "Building your baseline. This round starts your baseline. 3 finished rounds unlock your average.",
    handicap: null,
    ranks: [],
    trend: null,
    holesBetter: [],
    holesWorse: [],
    biggestOpportunity: "Keep the ball in play. 2 penalty strokes on hole 12.",
  },
};

describe.skipIf(!process.env.CADDY_E2E)("round summary, live model", () => {
  it("writes a short take grounded in the round and its history", async () => {
    const take = await writeTake(WITH_HISTORY);
    console.log("\n--- with history ---\n" + JSON.stringify(take, null, 2));
    expect(roundSummarySchema.safeParse(take).success).toBe(true);
    expect(take!.headline.length).toBeLessThanOrEqual(90);
    expect(take!.workOn.length).toBeGreaterThan(0);
  }, 90_000);

  it("does not claim improvement on a first round", async () => {
    const take = await writeTake(FIRST_ROUND);
    console.log("\n--- first round ---\n" + JSON.stringify(take, null, 2));
    expect(roundSummarySchema.safeParse(take).success).toBe(true);
    expect(take!.improving).toEqual([]);
  }, 90_000);
});
