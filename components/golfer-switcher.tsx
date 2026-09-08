"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, CaretDown, Check, NotePencil, Plus, User } from "@phosphor-icons/react";
import { useGolferRoster } from "@/hooks/use-golfer-roster";
import { useSelectedGolfer } from "@/hooks/use-selected-golfer";
import { createGolfer, refreshRoster, renameSelectedGolfer, selectGolfer } from "@/lib/golfer-session";
import type { Golfer } from "@/lib/golfers";

/**
 * Choosing who is playing.
 *
 * There is no sign-in yet, so this is the whole of identity: pick a golfer and
 * every round from then on is recorded against them. It reads as a switcher
 * rather than a login on purpose — swapping golfers on a shared phone should
 * stay a single tap once accounts do arrive.
 */

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

function AddGolferForm({ onAdded, label, fieldId }: { onAdded: (golfer: Golfer) => void; label: string; fieldId: string }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const value = name.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      const golfer = await createGolfer(value);
      setName("");
      onAdded(golfer);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add that golfer.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="golfer-form">
      <label htmlFor={fieldId}>{label}</label>
      <div className="golfer-entry">
        <input
          id={fieldId}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && void submit()}
          placeholder="Name"
          autoComplete="off"
          maxLength={60}
        />
        <button type="button" onClick={() => void submit()} disabled={!name.trim() || busy} aria-label="Add golfer">
          <Plus size={18} weight="bold" />
        </button>
      </div>
      {error ? <p className="voice-error">{error}</p> : null}
    </div>
  );
}

/** First run, or after clearing the browser: nobody is chosen yet. */
export function GolferGate() {
  const { golfers, error } = useGolferRoster();

  return (
    <div className="page-shell">
      <section className="golfer-gate surface-card">
        <div className="empty-mark"><User size={32} weight="fill" /></div>
        <h1>Who is playing?</h1>
        <p>Rounds are recorded against a golfer. Pick yours, or add a new one.</p>

        {error ? <p className="voice-error">{error}</p> : null}
        {golfers === null && !error ? <p className="golfer-loading">Loading golfers…</p> : null}

        {golfers?.length ? (
          <div className="golfer-list">
            {golfers.map((golfer) => (
              <button key={golfer.id} type="button" className="golfer-option" onClick={() => selectGolfer(golfer)}>
                <span className="golfer-initials">{initials(golfer.name)}</span>
                <strong>{golfer.name}</strong>
              </button>
            ))}
          </div>
        ) : null}

        <AddGolferForm
          fieldId="first-golfer-name"
          label={golfers?.length ? "Or add someone new" : "Add the first golfer"}
          onAdded={selectGolfer}
        />
      </section>
    </div>
  );
}

/** Topbar control showing who the app is recording for. */
export function GolferSwitcher() {
  const golfer = useSelectedGolfer();
  const { golfers, error } = useGolferRoster();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  if (!golfer) return null;

  function choose(next: Golfer) {
    selectGolfer(next);
    close();
  }

  function toggle() {
    if (open) {
      close();
      return;
    }
    setOpen(true);
    // Someone added on another device turns up on the next open.
    void refreshRoster();
  }

  return (
    <div className="golfer-switcher" ref={container}>
      <button
        type="button"
        className="golfer-button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="menu"
        title={`Playing as ${golfer.name}`}
      >
        <span className="golfer-initials">{initials(golfer.name)}</span>
        <span className="golfer-name">{golfer.name}</span>
        <CaretDown size={13} weight="bold" />
      </button>

      {open ? (
        <div className="golfer-panel surface-card" role="menu">
          <p className="eyebrow">PLAYING AS</p>

          {renaming ? (
            <RenameGolferForm golfer={golfer} onDone={() => setRenaming(false)} />
          ) : (
            <>
              {error ? <p className="voice-error">{error}</p> : null}
              <div className="golfer-list">
                {/* The selected golfer is known offline even when the roster is not. */}
                {(golfers ?? [golfer]).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="menuitem"
                    className={option.id === golfer.id ? "golfer-option selected" : "golfer-option"}
                    onClick={() => choose(option)}
                  >
                    <span className="golfer-initials">{initials(option.name)}</span>
                    <strong>{option.name}</strong>
                    {option.id === golfer.id ? <Check size={16} weight="bold" /> : null}
                  </button>
                ))}
              </div>

              <button type="button" className="golfer-secondary-action" onClick={() => setRenaming(true)}>
                <NotePencil size={15} /> Rename {golfer.name}
              </button>

              <AddGolferForm fieldId="add-golfer-name" label="Add a golfer" onAdded={choose} />
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
      setError(cause instanceof Error ? cause.message : "Could not rename that golfer.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="golfer-form">
      <label htmlFor="rename-golfer">New name</label>
      <div className="golfer-entry">
        <input
          id="rename-golfer"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && void submit()}
          autoComplete="off"
          maxLength={60}
          autoFocus
        />
        <button type="button" onClick={() => void submit()} disabled={!name.trim() || busy} aria-label="Save name">
          <Check size={18} weight="bold" />
        </button>
      </div>
      {error ? <p className="voice-error">{error}</p> : null}
      <button type="button" className="golfer-secondary-action" onClick={onDone}>
        <ArrowLeft size={15} /> Back to golfers
      </button>
    </div>
  );
}
