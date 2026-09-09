import { persistenceErrorResponse } from "@/lib/api-errors";
import { pinAccountEmail, pinCredentialsSchema } from "@/lib/pin-auth";
import { createPinAccountUser } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * Claims a name-and-PIN account. The browser only reaches here after signing in
 * with that pair has already failed, so an existing name means the PIN was
 * wrong. Both cases answer the same way, which keeps the response from
 * confirming whether a given name exists.
 */
export async function POST(request: Request) {
  try {
    const { name, pin } = pinCredentialsSchema.parse(await request.json());
    const outcome = await createPinAccountUser(pinAccountEmail(name), pin, name);
    if (outcome === "exists") {
      return Response.json({ error: "That name and PIN did not match." }, { status: 409 });
    }
    return Response.json({ created: true });
  } catch (cause) {
    return persistenceErrorResponse(cause);
  }
}
