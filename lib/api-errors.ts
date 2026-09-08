import { z } from "zod";
import { MissingGolferError } from "./golfers";
import { SupabaseConfigError, SupabaseRequestError } from "./supabase-server";

/** Turns persistence failures into a consistent JSON error response. */
export function persistenceErrorResponse(cause: unknown): Response {
  if (cause instanceof MissingGolferError) {
    // Today this only happens when the browser has no golfer selected. Once
    // there are accounts, this is the shape a rejected session takes.
    return Response.json({ error: "Pick a golfer before saving a round." }, { status: 400 });
  }
  if (cause instanceof z.ZodError) {
    return Response.json({ error: "Invalid payload.", issues: cause.issues }, { status: 400 });
  }
  if (cause instanceof SupabaseConfigError) {
    return Response.json({ error: cause.message }, { status: 503 });
  }
  if (cause instanceof SupabaseRequestError) {
    // 4xx from PostgREST means the payload will never succeed; surface it as such
    // so the client stops retrying it. Everything else is worth another attempt.
    const status = cause.status >= 400 && cause.status < 500 ? 422 : 502;
    return Response.json({ error: `Database rejected the write: ${cause.message}` }, { status });
  }
  const message = cause instanceof Error ? cause.message : "Unexpected persistence error.";
  return Response.json({ error: message }, { status: 500 });
}
