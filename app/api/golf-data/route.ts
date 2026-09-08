import { persistenceErrorResponse } from "@/lib/api-errors";
import { readGolfDataFromDb } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/** Full snapshot of every stored game and course. */
export async function GET() {
  try {
    return Response.json(await readGolfDataFromDb());
  } catch (cause) {
    return persistenceErrorResponse(cause);
  }
}
