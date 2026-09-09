"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, CaretDown, Check, GoogleLogo, NotePencil, SignOut, User } from "@phosphor-icons/react";
import { useAuth } from "@/hooks/use-auth";
import { useGolferRoster } from "@/hooks/use-golfer-roster";
import { useSelectedGolfer } from "@/hooks/use-selected-golfer";
import { clearGolferSession, refreshRoster, renameSelectedGolfer, selectGolfer } from "@/lib/golfer-session";
import { signInWithGoogle, signOut } from "@/lib/auth-client";
import { deleteCurrentAccount } from "@/lib/account-client";
import type { Golfer } from "@/lib/golfers";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

export function AccountGate() {
  const { session, error: authError } = useAuth();
  const { golfers, error: rosterError } = useGolferRoster();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (session) void refreshRoster();
  }, [session]);

  useEffect(() => {
    const golfer = golfers?.[0];
    if (session && golfer?.accountId === session.user.id) selectGolfer(golfer);
  }, [golfers, session]);

  async function login() {
    setBusy(true);
    setActionError(null);
    try {
      await signInWithGoogle();
      setBusy(false);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Google sign-in could not be started.");
      setBusy(false);
    }
  }

  const error = actionError ?? authError ?? rosterError;
  return (
    <div className="page-shell">
      <section className="golfer-gate surface-card">
        <div className="empty-mark"><User size={32} weight="fill" /></div>
        {session ? (
          <>
            <h1>Setting up your account</h1>
            <p>Connecting your verified Google account to your private golf history…</p>
            <p className="golfer-loading">Loading your rounds…</p>
          </>
        ) : (
          <>
            <h1>Sign in to Caddy Stack</h1>
            <p>Your rounds, courses, and progress stay attached to your account across web and Android.</p>
            <button className="primary-button google-sign-in" type="button" onClick={() => void login()} disabled={busy}>
              <GoogleLogo size={20} weight="bold" /> {busy ? "Opening Google…" : "Continue with Google"}
            </button>
          </>
        )}
        {error ? <p className="voice-error">{error}</p> : null}
      </section>
    </div>
  );
}

export function GolferSwitcher() {
  const golfer = useSelectedGolfer();
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setRenaming(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && close();
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  if (!golfer || !session) return null;

  async function logout() {
    setBusy(true);
    setError(null);
    try {
      await signOut();
      clearGolferSession();
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign out.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount() {
    setBusy(true);
    setError(null);
    try {
      await deleteCurrentAccount();
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete your account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="golfer-switcher" ref={container}>
      <button type="button" className="golfer-button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="menu">
        <span className="golfer-initials">{initials(golfer.name)}</span>
        <span className="golfer-name">{golfer.name}</span>
        <CaretDown size={13} weight="bold" />
      </button>

      {open ? (
        <div className="golfer-panel surface-card">
          <p className="eyebrow">YOUR ACCOUNT</p>
          {renaming ? (
            <RenameGolferForm golfer={golfer} onDone={() => setRenaming(false)} />
          ) : (
            <>
              <div className="account-summary">
                <span className="golfer-initials">{initials(golfer.name)}</span>
                <div><strong>{golfer.name}</strong><small>{session.user.email}</small></div>
              </div>
              <button type="button" className="golfer-secondary-action" onClick={() => setRenaming(true)}><NotePencil size={15} /> Rename profile</button>
              <button type="button" className="golfer-secondary-action" onClick={() => void logout()} disabled={busy}><SignOut size={15} /> {busy ? "Signing out…" : "Sign out"}</button>
              {confirmingDelete ? (
                <div className="delete-confirmation">
                  <p>This permanently deletes your account and every saved round.</p>
                  <button type="button" onClick={() => void deleteAccount()} disabled={busy}>{busy ? "Deleting…" : "Permanently delete"}</button>
                  <button type="button" onClick={() => setConfirmingDelete(false)} disabled={busy}>Cancel</button>
                </div>
              ) : (
                <button type="button" className="golfer-secondary-action danger-action" onClick={() => setConfirmingDelete(true)}>Delete account</button>
              )}
              {error ? <p className="voice-error">{error}</p> : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function RenameGolferForm({ golfer, onDone }: { golfer: Golfer; onDone: () => void }) {
  const [name, setName] = useState(golfer.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const value = name.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      await renameSelectedGolfer(value);
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not rename your profile.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="golfer-form">
      <label htmlFor="rename-golfer">Display name</label>
      <div className="golfer-entry">
        <input id="rename-golfer" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void submit()} maxLength={60} autoFocus />
        <button type="button" onClick={() => void submit()} disabled={!name.trim() || busy} aria-label="Save name"><Check size={18} weight="bold" /></button>
      </div>
      {error ? <p className="voice-error">{error}</p> : null}
      <button type="button" className="golfer-secondary-action" onClick={onDone}><ArrowLeft size={15} /> Back</button>
    </div>
  );
}
