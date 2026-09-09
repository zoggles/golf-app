"use client";

import { Capacitor } from "@capacitor/core";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

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
      detectSessionInUrl: true,
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

async function restoreSession() {
  const auth = supabase().auth;
  // supabase-js exchanges browser PKCE callbacks during client initialization.
  // Native callbacks arrive through appUrlOpen and are exchanged explicitly.
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

export async function signInWithGoogle(): Promise<void> {
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

export async function signOut(): Promise<void> {
  const { error } = await supabase().auth.signOut();
  if (error) throw error;
}

export async function signOutLocally(): Promise<void> {
  const { error } = await supabase().auth.signOut({ scope: "local" });
  if (error) throw error;
}
