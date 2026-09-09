import { persistenceErrorResponse } from "@/lib/api-errors";
import { resolveAuthenticatedGolferId } from "@/lib/auth-server";
import { readGolfDataFromDb } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/** Full snapshot of one golfer's games, plus the shared course catalogue. */
export async function GET(request: Request) {
  try {
    return Response.json(await readGolfDataFromDb(await resolveAuthenticatedGolferId(request)));
  } catch (cause) {
    return persistenceErrorResponse(cause);
  }
}
