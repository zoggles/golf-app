"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, CaretLeft, CaretRight, CheckCircle, Plus, Target, X } from "@phosphor-icons/react";
import {
  clubKind,
  clubsByLoft,
  clubShort,
  logShot,
  removeShot,
  setCarry,
  shotsSince,
  shotSpread,
  type Bag,
  type Club,
  type RangeShot,
} from "@/lib/bag";
import { endRangeSession, readBag, saveBag, selectRangeClub, type RangeSession } from "@/lib/bag-store";

/**
 * Range mode: pick the club in hand, set where the ball landed, log it. Built for one thumb
 * between swings, so the number starts where the last ball landed and the big button is
 * the one that matters.
 */

/** Three shots is where a median stops being a guess. */
const TRUSTED_SHOTS = 3;

export function RangeSessionView({ golferId, bag, session }: { golferId: string; bag: Bag; session: RangeSession }) {
  const [finishing, setFinishing] = useState(false);
  const ordered = clubsByLoft(bag);
  const club = ordered.find((item) => item.id === session.clubId) ?? ordered[0];
  const counts = new Map(ordered.map((item) => [item.id, shotsSince(item, session.startedAt).length]));
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const clubsHit = [...counts.values()].filter((count) => count > 0).length;
  const index = ordered.indexOf(club);
  const startedAt = new Date(session.startedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  if (finishing) {
    return <SessionSummary golferId={golferId} bag={bag} session={session} onBack={() => setFinishing(false)} />;
  }

  return (
    <div className="page-shell range-page">
      <header className="range-head">
        <div>
          <p className="eyebrow"><span className="live-dot" /> RANGE SESSION</p>
          <h1>{total} <span>{total === 1 ? "ball" : "balls"}</span></h1>
          <p>Since {startedAt} · {clubsHit} {clubsHit === 1 ? "club" : "clubs"} hit</p>
        </div>
        <button className="secondary-button range-finish" type="button" onClick={() => setFinishing(true)}>
          Finish
        </button>
      </header>

      <ClubRail clubs={ordered} activeId={club.id} counts={counts} onSelect={(id) => selectRangeClub(golferId, id)} />

      {/* Keyed by club so the yardage starts fresh from that club's own numbers. */}
      <ShotPad
        key={club.id}
        golferId={golferId}
        club={club}
        startedAt={session.startedAt}
        onPrevious={index > 0 ? () => selectRangeClub(golferId, ordered[index - 1].id) : null}
        onNext={index < ordered.length - 1 ? () => selectRangeClub(golferId, ordered[index + 1].id) : null}
      />
    </div>
  );
}

function ClubRail({
  clubs,
  activeId,
  counts,
  onSelect,
}: {
  clubs: Club[];
  activeId: string;
  counts: Map<string, number>;
  onSelect: (clubId: string) => void;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [activeId]);

  return (
    <div className="club-rail" role="tablist" aria-label="Club in hand">
      {clubs.map((club) => {
        const active = club.id === activeId;
        const count = counts.get(club.id) ?? 0;
        return (
          <button
            key={club.id}
            ref={active ? activeRef : undefined}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={`${club.label}, ${count} ${count === 1 ? "shot" : "shots"} this session`}
            className={`rail-chip kind-${clubKind(club)}${active ? " active" : ""}`}
            onClick={() => onSelect(club.id)}
          >
            <strong>{clubShort(club)}</strong>
            <small>{club.carryYds}</small>
            {count ? <em className="rail-count">{count}</em> : null}
          </button>
        );
      })}
    </div>
  );
}

interface ShotPadProps {
  golferId: string;
  club: Club;
  startedAt: string;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
}

function ShotPad({ golferId, club, startedAt, onPrevious, onNext }: ShotPadProps) {
  const sessionShots = shotsSince(club, startedAt);
  const earlierShots = (club.shots ?? []).filter((shot) => !sessionShots.includes(shot));
  const [yds, setYds] = useState(() => sessionShots[sessionShots.length - 1]?.yds ?? club.carryYds);
  const [draft, setDraft] = useState<string | null>(null);
  const [landedAt, setLandedAt] = useState<string | null>(null);
  const spread = shotSpread(sessionShots);

  const nudge = (delta: number) => {
    setDraft(null);
    setYds((current) => Math.min(400, Math.max(1, current + delta)));
  };

  function commitDraft() {
    if (draft === null) return;
    const typed = Number.parseInt(draft, 10);
    if (Number.isFinite(typed) && typed > 0) setYds(Math.min(400, typed));
    setDraft(null);
  }

  function log() {
    const typed = draft === null ? yds : Number.parseInt(draft, 10);
    if (!Number.isFinite(typed) || typed <= 0) return;
    const at = new Date().toISOString();
    saveBag(golferId, logShot(readBag(golferId), club.id, typed, at));
    setYds(typed);
    setDraft(null);
    setLandedAt(at);
    try {
      navigator.vibrate?.(12);
    } catch {
      // Not every webview lets a page buzz the phone.
    }
  }

  return (
    <section className={`shot-pad surface-card kind-${clubKind(club)}`} aria-label={`Logging ${club.label}`}>
      <div className="shot-pad-head">
        <button type="button" className="shot-pad-nav" onClick={onPrevious ?? undefined} disabled={!onPrevious} aria-label="Previous club">
          <CaretLeft size={18} weight="bold" />
        </button>
        <span className="club-chip big">{clubShort(club)}</span>
        <span className="shot-pad-title">
          <strong>{club.label}</strong>
          <small>Your bag says {club.carryYds} yds</small>
        </span>
        <button type="button" className="shot-pad-nav" onClick={onNext ?? undefined} disabled={!onNext} aria-label="Next club">
          <CaretRight size={18} weight="bold" />
        </button>
      </div>

      <div className="shot-entry">
        <button type="button" className="shot-step" onClick={() => nudge(-5)} aria-label="5 yards shorter">−5</button>
        <button type="button" className="shot-step" onClick={() => nudge(-1)} aria-label="1 yard shorter">−1</button>
        <label className="shot-readout">
          <input
            inputMode="numeric"
            pattern="[0-9]*"
            aria-label="Where this shot landed, in yards"
            value={draft ?? String(yds)}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setDraft(event.target.value.replace(/\D/g, "").slice(0, 3))}
            onBlur={commitDraft}
            onKeyDown={(event) => {
              if (event.key === "Enter") log();
            }}
          />
          <small>YARDS CARRY</small>
        </label>
        <button type="button" className="shot-step" onClick={() => nudge(1)} aria-label="1 yard longer">+1</button>
        <button type="button" className="shot-step" onClick={() => nudge(5)} aria-label="5 yards longer">+5</button>
      </div>

      <button type="button" className="primary-button shot-log" onClick={log}>
        <Plus size={20} weight="bold" /> Log shot
      </button>

      <Dispersion sessionShots={sessionShots} earlierShots={earlierShots} carry={club.carryYds} median={spread?.median ?? null} landedAt={landedAt} />

      {spread ? (
        <div className="shot-stats">
          <span><small>SHOTS</small><strong>{spread.count}</strong></span>
          <span><small>MEDIAN</small><strong>{spread.median}</strong></span>
          <span><small>SPREAD</small><strong>{spread.max - spread.min}<em> yds</em></strong></span>
        </div>
      ) : (
        <p className="shot-hint">
          <Target size={16} /> Watch where it lands, dial in the number, log it. The range flags are your yardstick.
        </p>
      )}

      {sessionShots.length ? (
        <ol className="shot-list" aria-label="Shots this session, newest first">
          {[...sessionShots].reverse().map((shot) => (
            <li key={shot.at} className={shot.at === landedAt ? "fresh" : undefined}>
              <span>{shot.yds}</span>
              <button
                type="button"
                aria-label={`Remove the ${shot.yds}-yard shot`}
                onClick={() => saveBag(golferId, removeShot(readBag(golferId), club.id, shot.at))}
              >
                <X size={11} weight="bold" />
              </button>
            </li>
          ))}
        </ol>
      ) : null}

      {spread && spread.median !== club.carryYds ? (
        <button
          type="button"
          className="shot-apply"
          onClick={() => saveBag(golferId, setCarry(readBag(golferId), club.id, spread.median))}
        >
          Set {club.label.toLowerCase()} to {spread.median} yds
          {spread.count < TRUSTED_SHOTS ? <small> · {TRUSTED_SHOTS - spread.count} more {TRUSTED_SHOTS - spread.count === 1 ? "shot" : "shots"} to trust it</small> : null}
        </button>
      ) : spread ? (
        <p className="shot-applied"><CheckCircle size={16} weight="fill" /> Your bag already says {club.carryYds}</p>
      ) : null}
    </section>
  );
}

/** Where height is meaningless, spread the dots a little so a cluster still reads as several balls. */
const JITTER = [50, 30, 68, 40, 60, 24, 76, 45, 35, 56];

function Dispersion({
  sessionShots,
  earlierShots,
  carry,
  median,
  landedAt,
}: {
  sessionShots: RangeShot[];
  earlierShots: RangeShot[];
  carry: number;
  median: number | null;
  landedAt: string | null;
}) {
  const earlier = earlierShots.slice(-20);
  const yards = [...sessionShots, ...earlier].map((shot) => shot.yds).concat(carry);
  let low = Math.floor((Math.min(...yards) - 8) / 5) * 5;
  let high = Math.ceil((Math.max(...yards) + 8) / 5) * 5;
  // A tight group on a narrow scale would look like a wild one.
  if (high - low < 40) {
    const pad = Math.ceil((40 - (high - low)) / 2 / 5) * 5;
    low -= pad;
    high += pad;
  }
  low = Math.max(0, low);
  const at = (value: number) => `${((value - low) / (high - low)) * 100}%`;

  return (
    <div className="dispersion" aria-hidden="true">
      <div className="dispersion-track">
        <small className="dispersion-end left">{low}</small>
        <small className="dispersion-end right">{high}</small>
        {earlier.map((shot, index) => (
          <span key={shot.at} className="shot-dot old" style={{ left: at(shot.yds), top: `${JITTER[index % JITTER.length]}%` }} />
        ))}
        <span className="dispersion-mark bag" style={{ left: at(carry) }}><small>BAG {carry}</small></span>
        {median !== null ? <span className="dispersion-mark median" style={{ left: at(median) }}><small>MEDIAN {median}</small></span> : null}
        {sessionShots.map((shot, index) => (
          <span
            key={shot.at}
            className={shot.at === landedAt ? "shot-dot new landed" : "shot-dot new"}
            style={{ left: at(shot.yds), top: `${JITTER[(index + 3) % JITTER.length]}%` }}
          />
        ))}
      </div>
    </div>
  );
}

function SessionSummary({
  golferId,
  bag,
  session,
  onBack,
}: {
  golferId: string;
  bag: Bag;
  session: RangeSession;
  onBack: () => void;
}) {
  const rows = clubsByLoft(bag).flatMap((club) => {
    const spread = shotSpread(shotsSince(club, session.startedAt));
    return spread ? [{ club, spread }] : [];
  });
  const total = rows.reduce((sum, row) => sum + row.spread.count, 0);
  const [chosen, setChosen] = useState(
    () =>
      new Set(
        rows
          .filter((row) => row.spread.count >= TRUSTED_SHOTS && row.spread.median !== row.club.carryYds)
          .map((row) => row.club.id),
      ),
  );

  function toggle(clubId: string) {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(clubId)) next.delete(clubId);
      else next.add(clubId);
      return next;
    });
  }

  function finish() {
    const updates = rows.filter((row) => chosen.has(row.club.id) && row.spread.median !== row.club.carryYds);
    if (updates.length) {
      saveBag(
        golferId,
        updates.reduce((next, row) => setCarry(next, row.club.id, row.spread.median), readBag(golferId)),
      );
    }
    endRangeSession(golferId);
  }

  const changing = rows.filter((row) => chosen.has(row.club.id) && row.spread.median !== row.club.carryYds).length;

  return (
    <div className="page-shell range-page">
      <section className="range-summary surface-card">
        <div className="range-summary-mark"><Target size={32} weight="duotone" /></div>
        <p className="eyebrow"><span />SESSION COMPLETE</p>
        {rows.length ? (
          <>
            <h2>{total} {total === 1 ? "ball" : "balls"} across {rows.length} {rows.length === 1 ? "club" : "clubs"}</h2>
            <p className="range-summary-copy">
              Pick the carries to update. Each uses the median of this session, so a topped ball or two will not drag it down.
            </p>
            <ul className="summary-list">
              {rows.map(({ club, spread }) => {
                const delta = spread.median - club.carryYds;
                const same = delta === 0;
                const on = chosen.has(club.id) && !same;
                return (
                  <li key={club.id}>
                    <label className={`summary-row kind-${clubKind(club)}${on ? " on" : ""}${same ? " same" : ""}`}>
                      <input type="checkbox" checked={on} disabled={same} onChange={() => toggle(club.id)} />
                      <span className="club-chip">{clubShort(club)}</span>
                      <span className="summary-name">
                        <strong>{club.label}</strong>
                        <small>
                          {spread.count} {spread.count === 1 ? "shot" : "shots"}
                          {spread.count > 1 ? ` · ${spread.min}–${spread.max}` : ""}
                          {spread.count < TRUSTED_SHOTS ? " · small sample" : ""}
                        </small>
                      </span>
                      {same ? (
                        <span className="summary-change"><strong>{club.carryYds}</strong><em className="even">no change</em></span>
                      ) : (
                        <span className="summary-change">
                          <s>{club.carryYds}</s>
                          <ArrowRight size={12} weight="bold" />
                          <strong>{spread.median}</strong>
                          <em className={delta > 0 ? "up" : "down"}>{delta > 0 ? "+" : "−"}{Math.abs(delta)}</em>
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <>
            <h2>No balls logged</h2>
            <p className="range-summary-copy">Nothing to update this time. Your bag is unchanged.</p>
          </>
        )}
        <div className="summary-actions">
          <button className="secondary-button" type="button" onClick={onBack}>Keep hitting</button>
          <button className="primary-button" type="button" onClick={finish}>
            {changing ? `Update ${changing} ${changing === 1 ? "carry" : "carries"}` : "End session"}
          </button>
        </div>
        {rows.length ? <p className="summary-foot">Every shot is kept either way, so each club’s range median keeps sharpening.</p> : null}
      </section>
    </div>
  );
}
