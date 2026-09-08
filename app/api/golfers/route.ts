import { persistenceErrorResponse } from "@/lib/api-errors";
import { golferPayloadSchema, resolveGolferId } from "@/lib/golfers";
import { createGolferRow, listGolferRows, renameGolferRow } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * The roster of golfers using this app.
 *
 * Listing everyone is deliberate while there is no sign-in: picking a golfer is
 * how the app knows whose round it is recording. Once accounts exist, this is
 * where the list narrows to the people the caller is allowed to see.
 */
export async function GET() {
  try {
    return Response.json({ golfers: await listGolferRows() });
  } catch (cause) {
    return persistenceErrorResponse(cause);
  }
}

export async function POST(request: Request) {
  try {
    const { name } = golferPayloadSchema.parse(await request.json());
    return Response.json({ golfer: await createGolferRow(name) });
  } catch (cause) {
    return persistenceErrorResponse(cause);
  }
}

/** Renames the golfer the request is acting as, and only that one. */
export async function PATCH(request: Request) {
  try {
    const golferId = resolveGolferId(request);
    const { name } = golferPayloadSchema.parse(await request.json());
    return Response.json({ golfer: await renameGolferRow(golferId, name) });
  } catch (cause) {
    return persistenceErrorResponse(cause);
  }
}
