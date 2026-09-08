import { persistenceErrorResponse } from "@/lib/api-errors";
import { resolveGolferId } from "@/lib/golfers";
import { readGolfDataFromDb } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/** Full snapshot of one golfer's games, plus the shared course catalogue. */
export async function GET(request: Request) {
  try {
    return Response.json(await readGolfDataFromDb(resolveGolferId(request)));
  } catch (cause) {
    return persistenceErrorResponse(cause);
  }
}
