import { persistenceErrorResponse } from "@/lib/api-errors";
import { parseGamePayload } from "@/lib/golf-payloads";
import { deleteGameRow, saveGameRow } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/** Upserts one game record. Idempotent, so the client can safely retry it. */
export async function POST(request: Request) {
  try {
    const round = parseGamePayload(await request.json());
    return Response.json({ game: await saveGameRow(round) });
  } catch (cause) {
    return persistenceErrorResponse(cause);
  }
}

export async function DELETE(request: Request) {
  try {
    const gameId = new URL(request.url).searchParams.get("id");
    if (!gameId) return Response.json({ error: "Missing game id." }, { status: 400 });
    await deleteGameRow(gameId);
    return Response.json({ ok: true });
  } catch (cause) {
    return persistenceErrorResponse(cause);
  }
}
