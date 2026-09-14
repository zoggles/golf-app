"use client";

import { useEffect, useMemo, useState } from "react";
import type { SummaryInput } from "@/lib/round-report";
import { loadRoundSummary, readCachedSummary, RoundSummaryError } from "@/lib/round-summary-client";
import type { RoundSummary } from "@/lib/round-summary-payloads";

export type SummaryState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; summary: RoundSummary }
  | { status: "error"; message: string; retryable: boolean };

/**
 * The AI summary for a round: shown from this device's copy when the round is unchanged,
 * fetched or written otherwise.
 *
 * Loading is derived rather than stored. A result is tagged with the request it answers, and
 * anything without a matching result is in flight, so no state is set synchronously inside
 * the effect and a stale answer for an older fingerprint can never be shown.
 */
export function useRoundSummary(request: {
  roundId: string;
  fingerprint: string;
  input: SummaryInput;
  enabled: boolean;
}): { state: SummaryState; retry: () => void } {
  const { roundId, fingerprint, input, enabled } = request;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; state: SummaryState } | null>(null);
  const key = `${roundId}:${fingerprint}:${attempt}`;
  const cached = useMemo(() => readCachedSummary(roundId, fingerprint), [roundId, fingerprint]);
  // Serialised so a new-but-identical input object does not start another request.
  const inputJson = JSON.stringify(input);

  useEffect(() => {
    if (!enabled || cached) return;
    const controller = new AbortController();
    loadRoundSummary({ roundId, fingerprint, input: JSON.parse(inputJson) as SummaryInput, signal: controller.signal })
      .then((summary) => setResult({ key, state: { status: "ready", summary } }))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setResult({
          key,
          state: cause instanceof RoundSummaryError
            ? { status: "error", message: cause.message, retryable: cause.retryable }
            : { status: "error", message: "Couldn’t reach the caddy. Check your signal and try again.", retryable: true },
        });
      });
    return () => controller.abort();
  }, [enabled, cached, roundId, fingerprint, inputJson, key]);

  let state: SummaryState;
  if (!enabled) state = { status: "idle" };
  else if (cached) state = { status: "ready", summary: cached };
  else if (result?.key === key) state = result.state;
  else state = { status: "loading" };

  return { state, retry: () => setAttempt((count) => count + 1) };
}
