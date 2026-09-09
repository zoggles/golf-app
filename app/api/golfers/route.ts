import { persistenceErrorResponse } from "@/lib/api-errors";
import { resolveAuthenticatedGolfer } from "@/lib/auth-server";
import { golferPayloadSchema } from "@/lib/golfers";
import { renameGolferRow } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/** Returns only the profile owned by the verified Google account. */
export async function GET(request: Request) {
  try {
    const { user, golfer } = await resolveAuthenticatedGolfer(request);
    return Response.json({ golfers: [{ ...golfer, accountId: user.id }] });
  } catch (cause) {
    return persistenceErrorResponse(cause);
  }
}

/** Renames the golfer the request is acting as, and only that one. */
export async function PATCH(request: Request) {
  try {
    const { user, golfer } = await resolveAuthenticatedGolfer(request);
    const { name } = golferPayloadSchema.parse(await request.json());
    return Response.json({ golfer: { ...(await renameGolferRow(golfer.id, name)), accountId: user.id } });
  } catch (cause) {
    return persistenceErrorResponse(cause);
  }
}
