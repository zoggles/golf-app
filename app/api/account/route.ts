import { AuthenticationError, requireAuthUser } from "@/lib/auth-server";
import { persistenceErrorResponse } from "@/lib/api-errors";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** Permanently deletes the verified user; database cascades remove their golfer and rounds. */
export async function DELETE(request: Request) {
  try {
    const user = await requireAuthUser(request);
    if (!SUPABASE_URL || !SERVICE_KEY) throw new AuthenticationError("Account deletion is not configured.");
    const response = await fetch(
      `${SUPABASE_URL.replace(/\/+$/, "")}/auth/v1/admin/users/${encodeURIComponent(user.id)}`,
      {
        method: "DELETE",
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
        cache: "no-store",
      },
    );
    if (!response.ok) throw new Error(`Account deletion failed (${response.status}).`);
    return Response.json({ ok: true });
  } catch (cause) {
    return persistenceErrorResponse(cause);
  }
}
