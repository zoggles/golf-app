import { generateText, Output } from "ai";
import { z } from "zod";
import { persistenceErrorResponse } from "@/lib/api-errors";
import { resolveAuthenticatedGolferId } from "@/lib/auth-server";
import { AuthenticationError } from "@/lib/auth-token";
import { roundSummaryRequestSchema, roundSummarySchema } from "@/lib/round-summary-payloads";
import { ROUND_SUMMARY_MODEL, ROUND_SUMMARY_SYSTEM, roundSummaryPrompt } from "@/lib/round-summary-prompt";
import {
  gameBelongsToGolfer,
  readRoundSummaryRow,
  saveRoundSummaryRow,
  SupabaseConfigError,
  SupabaseRequestError,
} from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Serves a stored summary when it still matches the round, and nothing otherwise. */
export async function GET(request: Request) {
  try {
    const golferId = await resolveAuthenticatedGolferId(request);
    const params = new URL(request.url).searchParams;
    const roundId = params.get("roundId");
    const fingerprint = params.get("fingerprint");
    if (!roundId || !fingerprint) {
      return Response.json({ error: "A roundId and fingerprint are required." }, { status: 400 });
    }

    const stored = await readRoundSummaryRow(roundId, golferId);
    if (!stored || stored.fingerprint !== fingerprint) return Response.json({ summary: null });
    const parsed = roundSummarySchema.safeParse(stored.summary);
    return Response.json({ summary: parsed.success ? parsed.data : null });
  } catch (cause) {
    return persistenceErrorResponse(cause);
  }
}

/** Writes the summary once per version of the round and stores it. */
export async function POST(request: Request) {
  try {
    const golferId = await resolveAuthenticatedGolferId(request);
    const { roundId, fingerprint, input } = roundSummaryRequestSchema.parse(await request.json());

    if (!(await gameBelongsToGolfer(roundId, golferId))) {
      return Response.json(
        { error: "This round hasn’t synced yet. The caddy will weigh in once it has.", retryable: true },
        { status: 404 },
      );
    }

    // Two devices opening the same round should not pay for two summaries.
    const stored = await readRoundSummaryRow(roundId, golferId);
    if (stored && stored.fingerprint === fingerprint) {
      const parsed = roundSummarySchema.safeParse(stored.summary);
      if (parsed.success) return Response.json({ summary: parsed.data });
    }

    const result = await generateText({
      model: ROUND_SUMMARY_MODEL,
      maxRetries: 1,
      maxOutputTokens: 700,
      providerOptions: {
        google: { thinkingConfig: { thinkingBudget: 0 } },
      },
      output: Output.object({ schema: roundSummarySchema }),
      system: ROUND_SUMMARY_SYSTEM,
      prompt: roundSummaryPrompt(input),
    });

    const summary = result.output;
    if (!summary) throw new Error("The model returned no summary.");

    await saveRoundSummaryRow({ gameId: roundId, golferId, fingerprint, summary, model: ROUND_SUMMARY_MODEL });
    return Response.json({ summary });
  } catch (cause) {
    if (
      cause instanceof AuthenticationError ||
      cause instanceof z.ZodError ||
      cause instanceof SupabaseConfigError ||
      cause instanceof SupabaseRequestError
    ) {
      return persistenceErrorResponse(cause);
    }
    console.error("Round summary failed", cause);
    if (/valid credit card|free tier users do not have access/i.test(String(cause))) {
      return Response.json(
        { error: "The caddy is waiting on Vercel AI Gateway billing to be set up.", retryable: false },
        { status: 503 },
      );
    }
    if (/rate.?limit/i.test(String(cause))) {
      return Response.json({ error: "The caddy is swamped. Give it a minute.", retryable: true }, { status: 429 });
    }
    return Response.json({ error: "The caddy lost the plot writing this one. Give it another go.", retryable: true }, { status: 502 });
  }
}
