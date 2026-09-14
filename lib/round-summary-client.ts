"use client";

import { apiUrl } from "./api-url";
import { authHeaders } from "./auth-client";
import type { SummaryInput } from "./round-report";
import type { RoundSummary } from "./round-summary-payloads";

/**
 * Fetches the AI summary for a round, keeping a copy on this device.
 *
 * The copy is keyed by the round's fingerprint, so it is shown instantly and offline for as
 * long as the round is unchanged, and quietly ignored the moment a score is edited.
 */

const KEY_PREFIX = "caddy-stack:round-summary:v1:";

export class RoundSummaryError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "RoundSummaryError";
    this.retryable = retryable;
  }
}

export function readCachedSummary(roundId: string, fingerprint: string): RoundSummary | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + roundId);
    const parsed = raw ? (JSON.parse(raw) as { fingerprint?: string; summary?: RoundSummary }) : null;
    return parsed?.fingerprint === fingerprint && parsed.summary ? parsed.summary : null;
  } catch {
    return null;
  }
}

function cacheSummary(roundId: string, fingerprint: string, summary: RoundSummary): void {
  try {
    window.localStorage.setItem(KEY_PREFIX + roundId, JSON.stringify({ fingerprint, summary }));
  } catch {
    // Storage can be full or blocked; the summary still shows for this visit.
  }
}

async function errorFrom(response: Response): Promise<RoundSummaryError> {
  const body = (await response.json().catch(() => ({}))) as { error?: string; retryable?: boolean };
  return new RoundSummaryError(
    body.error || "The caddy couldn’t write this one.",
    body.retryable ?? response.status >= 500,
  );
}

export async function loadRoundSummary(request: {
  roundId: string;
  fingerprint: string;
  input: SummaryInput;
  signal?: AbortSignal;
}): Promise<RoundSummary> {
  const { roundId, fingerprint, input, signal } = request;
  const query = `roundId=${encodeURIComponent(roundId)}&fingerprint=${fingerprint}`;

  // Ask for a stored summary first: writing one costs a model call, reading one does not.
  const stored = await fetch(apiUrl(`/api/round-summary?${query}`), {
    cache: "no-store",
    headers: authHeaders(),
    signal,
  });
  if (stored.ok) {
    const body = (await stored.json()) as { summary?: RoundSummary | null };
    if (body.summary) {
      cacheSummary(roundId, fingerprint, body.summary);
      return body.summary;
    }
  } else if (stored.status === 401) {
    throw await errorFrom(stored);
  }

  const created = await fetch(apiUrl("/api/round-summary"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ roundId, fingerprint, input }),
    signal,
  });
  if (!created.ok) throw await errorFrom(created);
  const body = (await created.json()) as { summary?: RoundSummary };
  if (!body.summary) throw new RoundSummaryError("The caddy couldn’t write this one.", true);
  cacheSummary(roundId, fingerprint, body.summary);
  return body.summary;
}
