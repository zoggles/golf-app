import "server-only";

import { ensureGolferRow } from "./supabase-server";
import { AuthenticationError, bearerToken } from "./auth-token";

export { AuthenticationError } from "./auth-token";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export interface AuthUser {
  id: string;
  email: string;
  app_metadata?: { provider?: string; providers?: string[] };
  user_metadata?: Record<string, unknown>;
}

export async function requireAuthUser(request: Request): Promise<AuthUser> {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new AuthenticationError("Authentication is not configured.");
  const response = await fetch(`${SUPABASE_URL.replace(/\/+$/, "")}/auth/v1/user`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${bearerToken(request)}` },
    cache: "no-store",
  });
  if (!response.ok) throw new AuthenticationError("Your session expired. Sign in again.");
  const user = (await response.json()) as Partial<AuthUser>;
  if (!user.id || !user.email) throw new AuthenticationError("Your Google account has no verified email.");
  // "email" is the name-and-PIN path; those accounts are created server side and
  // never accept a self-supplied address, so the provider is enough to trust it.
  const providers = user.app_metadata?.providers ?? [user.app_metadata?.provider].filter(Boolean);
  const allowed = providers.some((provider) => provider === "google" || provider === "email");
  if (!allowed) throw new AuthenticationError("Sign in with Google or a name and PIN.");
  return {
    id: user.id,
    email: user.email,
    app_metadata: user.app_metadata,
    user_metadata: user.user_metadata,
  };
}

export async function resolveAuthenticatedGolfer(request: Request) {
  const user = await requireAuthUser(request);
  const golfer = await ensureGolferRow(user);
  return { user, golfer };
}

export async function resolveAuthenticatedGolferId(request: Request): Promise<string> {
  return (await resolveAuthenticatedGolfer(request)).golfer.id;
}
