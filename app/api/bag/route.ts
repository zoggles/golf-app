import { persistenceErrorResponse } from "@/lib/api-errors";
import { resolveAuthenticatedGolferId } from "@/lib/auth-server";
import { isNewerBag, normalizeBag } from "@/lib/bag";
import { bagPayloadSchema } from "@/lib/bag-payloads";
import { readBagRow, saveBagRow } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/** The signed-in golfer's bag, or null before any device has saved one. */
export async function GET(request: Request) {
  try {
    const golferId = await resolveAuthenticatedGolferId(request);
    return Response.json({ bag: await readBagRow(golferId) });
  } catch (cause) {
    return persistenceErrorResponse(cause);
  }
}

/**
 * Stores the bag unless the database already holds a newer one, in which case that one comes
 * back and the device adopts it. Last change wins, whichever device made it.
 */
export async function PUT(request: Request) {
  try {
    const golferId = await resolveAuthenticatedGolferId(request);
    const incoming = normalizeBag(bagPayloadSchema.parse(await request.json()).bag);
    const stored = await readBagRow(golferId);
    if (stored && isNewerBag(stored, incoming)) return Response.json({ bag: stored });
    return Response.json({ bag: await saveBagRow(golferId, incoming) });
  } catch (cause) {
    return persistenceErrorResponse(cause);
  }
}
