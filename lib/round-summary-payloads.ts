import { z } from "zod";

/** Validation for the round summary route, in both directions. */

const line = (max: number) => z.string().trim().min(1).max(max);

/** Mirrors `SummaryInput` in ./round-report, bounded so a request cannot smuggle in an essay. */
export const summaryInputSchema = z.object({
  course: line(120),
  segment: line(20),
  playedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  score: z.object({
    total: z.number().int().min(0).max(300),
    par: z.number().int().min(0).max(120),
    toPar: line(8),
    holes: z.number().int().min(1).max(18),
  }),
  scoreMix: z.record(z.string().max(20), z.number().int().min(0).max(18)),
  wentWell: z.array(line(160)).max(8),
  costYou: z.array(line(160)).max(8),
  history: z.object({
    previousRounds: z.number().int().min(0).max(50),
    improving: z.array(line(160)).max(10),
    slipping: z.array(line(160)).max(10),
  }),
  // Optional so an app build from before the baseline existed can still ask for a take.
  personal: z
    .object({
      comparison: line(260),
      handicap: line(160).nullable(),
      ranks: z.array(line(160)).max(4),
      trend: line(200).nullable(),
      holesBetter: z.array(line(200)).max(5),
      holesWorse: z.array(line(200)).max(5),
      biggestOpportunity: line(320).nullable(),
    })
    .optional(),
});

export const roundSummaryRequestSchema = z.object({
  roundId: line(200),
  fingerprint: z.string().regex(/^[0-9a-f]{8}$/),
  input: summaryInputSchema,
});

/**
 * What the model must return. The length caps are ceilings, set above what the prompt asks
 * for, so a slightly long joke is still accepted while a rambling one is not.
 */
export const roundSummarySchema = z.object({
  headline: z.string().min(8).max(110).describe("One punchy line about the round. A joke is welcome."),
  improving: z
    .array(z.string().min(8).max(140))
    .max(3)
    .describe("What got better than the earlier rounds, taken only from history.improving. Empty when nothing did."),
  workOn: z
    .array(z.string().min(8).max(140))
    .min(1)
    .max(2)
    .describe("The one or two things to work on, each naming a specific hole, stat or slipping trend."),
  signOff: z.string().min(4).max(120).describe("A closing line: praise, a joke, or both."),
});

export type RoundSummary = z.infer<typeof roundSummarySchema>;
