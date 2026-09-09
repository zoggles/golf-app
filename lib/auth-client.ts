"use client";

import { Capacitor } from "@capacitor/core";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { apiUrl } from "./api-url";
import { pinAccountEmail, pinCredentialsSchema } from "./pin-auth";

export interface AuthState {
  session: Session | null | undefined;
  error: string | null;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const NATIVE_AUTH_CALLBACK = "com.zogby.caddystack://auth/callback";

const listeners = new Set<() => void>();
let snapshot: AuthState = { session: undefined, error: null };
let client: SupabaseClient | null = null;
let started = false;

function publish(next: AuthState) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function supabase(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("Supabase authentication is not configured.");
  }
  client ??= createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // The browser callback is exchanged explicitly below. Leaving this on made
      // supabase-js exchange the same single-use code a second time ~40ms later,
      // and that failure discarded the session the first exchange had stored.
      detectSessionInUrl: false,
      flowType: "pkce",
    },
  });
  return client;
}

async function finishNativeSignIn(callbackUrl: string) {
  if (!callbackUrl.startsWith(NATIVE_AUTH_CALLBACK)) return;
  try {
    const url = new URL(callbackUrl);
    const code = url.searchParams.get("code");
    if (code) {
      const { error } = await supabase().auth.exchangeCodeForSession(code);
      if (error) throw error;
    } else {
      const params = new URLSearchParams(url.hash.slice(1));
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      if (!accessToken || !refreshToken) throw new Error("Google did not return a valid session.");
      const { error } = await supabase().auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      if (error) throw error;
    }
    const { Browser } = await import("@capacitor/browser");
    await Browser.close();
    window.location.hash = "#/play";
  } catch (cause) {
    publish({ session: null, error: cause instanceof Error ? cause.message : "Google sign-in failed." });
  }
}

/** Exchanges a browser OAuth callback exactly once, then cleans the URL. */
async function completeBrowserSignIn(): Promise<void> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const failure = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (!code && !failure) return;
  for (const param of ["code", "error", "error_description", "error_code", "state"]) {
    url.searchParams.delete(param);
  }
  window.history.replaceState(null, "", url.toString());
  if (failure) throw new Error(failure);
  const { error } = await supabase().auth.exchangeCodeForSession(code as string);
  if (error) throw error;
}

async function restoreSession() {
  const auth = supabase().auth;
  // Browser callbacks are exchanged here; native ones arrive via appUrlOpen.
  if (!Capacitor.isNativePlatform()) await completeBrowserSignIn();
  const { data, error } = await auth.getSession();
  if (error) throw error;
  publish({ session: data.session, error: null });
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  try {
    const auth = supabase().auth;
    void restoreSession().catch(async (cause) => {
      // A PKCE code is single-use, so a redundant exchange rejects even when the
      // first one already stored a valid session. Trust stored state over the error.
      const { data } = await auth.getSession();
      if (data.session) {
        publish({ session: data.session, error: null });
        return;
      }
      publish({ session: null, error: cause instanceof Error ? cause.message : "Google sign-in failed." });
    });
    auth.onAuthStateChange((event, session) => {
      // A redundant PKCE exchange rejects and emits a null session even though an
      // earlier exchange already stored a valid one. Only an explicit sign-out
      // clears the store; any other null is reconciled against stored state.
      if (session || event === "SIGNED_OUT") {
        publish({ session, error: null });
        return;
      }
      void auth.getSession().then(({ data }) => publish({ session: data.session, error: null }));
    });

    if (Capacitor.isNativePlatform()) {
      void import("@capacitor/app").then(({ App }) =>
        App.addListener("appUrlOpen", ({ url }) => void finishNativeSignIn(url)),
      );
    }
  } catch (cause) {
    publish({ session: null, error: cause instanceof Error ? cause.message : "Authentication is unavailable." });
  }
}

export function subscribeToAuth(onChange: () => void): () => void {
  start();
  listeners.add(onChange);
  return () => void listeners.delete(onChange);
}

export function readAuth(): AuthState {
  start();
  return snapshot;
}

export function authHeaders(): Record<string, string> {
  const token = snapshot.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * supabase-js keeps a code verifier per PKCE flow and never removes the entries
 * for flows the user abandoned. A later callback can then be exchanged against a
 * stale verifier, which fails with 401 and never recovers on its own. This app
 * only ever has one sign-in in flight, so drop the leftovers before starting.
 */
function clearPendingPkceFlows(): void {
  if (typeof window === "undefined") return;
  try {
    const ref = new URL(SUPABASE_URL).hostname.split(".")[0];
    const prefix = `sb-${ref}-auth-token`;
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(prefix) && key.includes("code-verifier")) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // A browser that refuses storage cannot hold stale flows either.
  }
}

export async function signInWithGoogle(): Promise<void> {
  clearPendingPkceFlows();
  const native = Capacitor.isNativePlatform();
  const redirectTo = native ? NATIVE_AUTH_CALLBACK : `${window.location.origin}/play`;
  const { data, error } = await supabase().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, skipBrowserRedirect: native },
  });
  if (error) throw error;
  if (native) {
    if (!data.url) throw new Error("Google sign-in could not be opened.");
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url: data.url });
  }
}

/**
 * Signs in with a name and PIN, claiming the name the first time it is used.
 * Sign-in is tried before provisioning so an existing name with the wrong PIN
 * fails as a mismatch rather than quietly creating a second account.
 */
export async function signInWithPin(name: string, pin: string): Promise<void> {
  const parsed = pinCredentialsSchema.safeParse({ name, pin });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check your name and PIN.");
  const credentials = parsed.data;
  const email = pinAccountEmail(credentials.name);
  const auth = supabase().auth;

  const existing = await auth.signInWithPassword({ email, password: credentials.pin });
  if (!existing.error) return;

  const response = await fetch(apiUrl("/api/pin-auth"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });
  const result = (await response.json()) as { created?: boolean; error?: string };
  if (!response.ok) throw new Error(result.error || "Could not sign in with that name and PIN.");

  const claimed = await auth.signInWithPassword({ email, password: credentials.pin });
  if (claimed.error) throw claimed.error;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase().auth.signOut();
  if (error) throw error;
}

export async function signOutLocally(): Promise<void> {
  const { error } = await supabase().auth.signOut({ scope: "local" });
  if (error) throw error;
}
