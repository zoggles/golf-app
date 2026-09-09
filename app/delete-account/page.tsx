"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { GoogleLogo, Warning } from "@phosphor-icons/react";
import { deleteCurrentAccount } from "@/lib/account-client";
import { useAuth } from "@/hooks/use-auth";
import { signInWithGoogle } from "@/lib/auth-client";

export default function DeleteAccountPage() {
  const router = useRouter();
  const { session } = useAuth();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deleteCurrentAccount();
      router.push("/play");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete your account.");
      setBusy(false);
    }
  }

  async function login() {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
      setBusy(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Google sign-in could not be started.");
      setBusy(false);
    }
  }

  return (
    <div className="page-shell">
      <section className="golfer-gate surface-card">
        <div className="empty-mark"><Warning size={32} weight="fill" /></div>
        <h1>Delete your Caddy Stack account</h1>
        <p>This permanently deletes your golf profile, saved rounds, scores, and personal game metrics. It does not delete your Google account.</p>
        {!session ? (
          <button className="primary-button google-sign-in" type="button" onClick={() => void login()} disabled={busy}>
            <GoogleLogo size={20} weight="bold" /> {busy ? "Opening Google…" : "Sign in to verify your account"}
          </button>
        ) : confirmed ? (
          <div className="delete-confirmation">
            <p>This cannot be undone. Do you want to permanently delete all of your Caddy Stack data?</p>
            <button type="button" onClick={() => void remove()} disabled={busy}>{busy ? "Deleting…" : "Yes, delete everything"}</button>
            <button type="button" onClick={() => setConfirmed(false)} disabled={busy}>Cancel</button>
          </div>
        ) : (
          <button className="secondary-button danger-action" type="button" onClick={() => setConfirmed(true)}>Delete my account</button>
        )}
        {error ? <p className="voice-error">{error}</p> : null}
        <p><Link href="/play">Return to Caddy Stack</Link></p>
      </section>
    </div>
  );
}
