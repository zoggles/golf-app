"use client";

import { Fragment, useState, type CSSProperties } from "react";
import {
  ArrowCounterClockwise,
  ArrowRight,
  CheckCircle,
  CloudArrowUp,
  CloudCheck,
  CloudSlash,
  Plus,
  Target,
  Trash,
} from "@phosphor-icons/react";
import { RangeSessionView } from "@/components/range-session";
import { useBag, useBagSyncStatus, useRangeSession } from "@/hooks/use-bag";
import { useSelectedGolfer } from "@/hooks/use-selected-golfer";
import {
  addClub,
  bagGaps,
  CLUB_CATALOG,
  clubKind,
  clubsByLoft,
  clubShort,
  MAX_CARRY_YDS,
  MAX_CLUBS,
  MIN_CARRY_YDS,
  removeClub,
  setCarry,
  shotSpread,
  type Bag,
  type Club,
  type ClubGap,
  type ClubKind,
} from "@/lib/bag";
import { readBag, resetBag, saveBag, startRangeSession, syncBag, type BagSyncStatus } from "@/lib/bag-store";

/**
 * The bag, in one place: which clubs are in it, how far each one carries, and the range
 * sessions that set those numbers. Caddy View reads from here on every round.
 */

const KIND_GROUPS: Array<{ kind: ClubKind; label: string }> = [
  { kind: "wood", label: "Woods" },
  { kind: "hybrid", label: "Hybrids" },
  { kind: "iron", label: "Irons" },
  { kind: "wedge", label: "Wedges" },
];

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function MyClubsPage() {
  const golferId = useSelectedGolfer()?.id ?? null;
  const bag = useBag(golferId);
  const syncStatus = useBagSyncStatus(golferId);
  const session = useRangeSession(golferId);
  const [openId, setOpenId] = useState<string | null>(null);

  if (!golferId) return null;
  if (session) return <RangeSessionView golferId={golferId} bag={bag} session={session} />;

  const ordered = clubsByLoft(bag);
  const gaps = bagGaps(bag);
  const longest = ordered.reduce((best, club) => (club.carryYds > best.carryYds ? club : best), ordered[0]);
  const shortest = ordered.reduce((best, club) => (club.carryYds < best.carryYds ? club : best), ordered[0]);
  const allShots = bag.clubs.flatMap((club) => club.shots ?? []);
  const lastShotAt = allShots.reduce<string | null>((latest, shot) => (!latest || shot.at > latest ? shot.at : latest), null);
  // Fifty-yard gridlines, with headroom past the longest club so its bar never touches the edge.
  const scaleYds = Math.ceil((longest.carryYds + 15) / 50) * 50;
  const warmUpClub = ordered.find((club) => club.id === "pw") ?? ordered[ordered.length - 1];

  function addToBag(clubId: string) {
    saveBag(golferId!, addClub(readBag(golferId), clubId));
    setOpenId(clubId);
  }

  return (
    <div className="page-shell clubs-page">
      <section className="clubs-hero">
        <div className="clubs-title-row">
          <div>
            <p className="eyebrow"><span />YOUR BAG</p>
            <h1>My Clubs</h1>
          </div>
          <SyncPill status={syncStatus} />
        </div>
        <p className="clubs-lede">Every carry here feeds Caddy View’s club picks, on every round and every device.</p>
        <BagMeter clubs={ordered} />
        <div className="clubs-stats">
          <span><small>LONGEST</small><strong>{longest.carryYds}</strong><em>{longest.label}</em></span>
          <span><small>SHORTEST</small><strong>{shortest.carryYds}</strong><em>{shortest.label}</em></span>
          <span><small>RANGE SHOTS</small><strong>{allShots.length}</strong><em>{lastShotAt ? `Last ${shortDate(lastShotAt)}` : "None yet"}</em></span>
        </div>
      </section>

      <button className="range-cta" type="button" onClick={() => startRangeSession(golferId, warmUpClub?.id ?? null)}>
        <span className="range-cta-icon"><Target size={28} weight="duotone" /></span>
        <span className="range-cta-copy">
          <small>HEADED TO THE RANGE?</small>
          <strong>Start a range session</strong>
          <span>Log each ball as it lands. Your carries come from what you actually hit.</span>
        </span>
        <ArrowRight className="range-cta-arrow" size={22} weight="bold" />
      </button>

      <section className="carry-ladder surface-card" style={{ "--tick": `${(50 / scaleYds) * 100}%` } as CSSProperties}>
        <header className="ladder-head">
          <div>
            <h2>Carry ladder</h2>
            <p>Strongest loft to weakest. Tap a club to set its number.</p>
          </div>
        </header>
        <div className="ladder-scale" aria-hidden="true">
          {Array.from({ length: scaleYds / 50 - 1 }, (_, index) => (index + 1) * 50).map((yds) => (
            <small key={yds} style={{ left: `${(yds / scaleYds) * 100}%` }}>{yds}</small>
          ))}
        </div>
        <ol className="ladder">
          {ordered.map((club, index) => (
            <Fragment key={club.id}>
              {index > 0 ? <GapMarker gap={gaps[index - 1]} /> : null}
              <ClubRow
                golferId={golferId}
                club={club}
                scaleYds={scaleYds}
                open={openId === club.id}
                canRemove={bag.clubs.length > 1}
                onToggle={() => setOpenId(openId === club.id ? null : club.id)}
              />
            </Fragment>
          ))}
        </ol>
      </section>

      <AddClubs bag={bag} onAdd={addToBag} />
      <ResetBag golferId={golferId} />
    </div>
  );
}

function SyncPill({ status }: { status: BagSyncStatus }) {
  if (status === "syncing") {
    return <span className="sync-pill busy"><CloudArrowUp size={15} weight="bold" /> Syncing</span>;
  }
  if (status === "offline" || status === "error") {
    return (
      <button className="sync-pill warn" type="button" onClick={() => void syncBag()} title="Saved on this device. Tap to try the sync again.">
        <CloudSlash size={15} weight="bold" /> {status === "offline" ? "Offline · saved here" : "Not synced · retry"}
      </button>
    );
  }
  return <span className="sync-pill"><CloudCheck size={15} weight="bold" /> {status === "synced" ? "Synced" : "Saved"}</span>;
}

/** Fourteen slots, putter first, each club tinted by what kind it is. */
function BagMeter({ clubs }: { clubs: Club[] }) {
  const count = clubs.length + 1;
  return (
    <div className="bag-meter">
      <div className="bag-meter-slots" role="img" aria-label={`${clubs.length} clubs plus a putter: ${count} of the 14 the rules allow`}>
        <span className="bag-slot putter" title="Putter" />
        {Array.from({ length: MAX_CLUBS }, (_, index) => {
          const club = clubs[index];
          return club ? (
            <span key={club.id} className={`bag-slot on kind-${clubKind(club)}`} title={club.label} />
          ) : (
            <span key={`empty-${index}`} className="bag-slot" />
          );
        })}
      </div>
      <p><span><strong>{count}</strong>/14</span><small>putter in</small></p>
    </div>
  );
}

function GapMarker({ gap }: { gap: ClubGap }) {
  const describe =
    gap.tone === "wide"
      ? `${gap.yds}-yd hole`
      : gap.yds < 0
        ? `Crossed by ${-gap.yds}`
        : gap.tone === "tight"
          ? `Only ${gap.yds} apart`
          : `${gap.yds} yds`;
  const title =
    gap.tone === "wide"
      ? `Nothing in the bag covers the ${gap.yds} yards between ${gap.upper.label} and ${gap.lower.label}.`
      : gap.yds < 0
        ? `${gap.lower.label} carries further than ${gap.upper.label}.`
        : gap.tone === "tight"
          ? `${gap.upper.label} and ${gap.lower.label} are doing nearly the same job.`
          : `${gap.yds} yards between ${gap.upper.label} and ${gap.lower.label}.`;
  return (
    <li className={`ladder-gap ${gap.tone}`} aria-label={title} title={title}>
      <span>{describe}</span>
    </li>
  );
}

interface ClubRowProps {
  golferId: string;
  club: Club;
  scaleYds: number;
  open: boolean;
  canRemove: boolean;
  onToggle: () => void;
}

function ClubRow({ golferId, club, scaleYds, open, canRemove, onToggle }: ClubRowProps) {
  const spread = shotSpread(club.shots ?? []);
  const pct = (yds: number) => `${Math.min(100, (yds / scaleYds) * 100)}%`;

  return (
    <li className={`ladder-row kind-${clubKind(club)}${open ? " open" : ""}`}>
      <button type="button" className="ladder-main" onClick={onToggle} aria-expanded={open}>
        <span className="club-chip">{clubShort(club)}</span>
        <span className="ladder-name">
          <strong>{club.label}</strong>
          <small>{spread ? `${spread.count} range ${spread.count === 1 ? "shot" : "shots"} · median ${spread.median}` : "No range shots yet"}</small>
        </span>
        <span className="ladder-carry"><strong>{club.carryYds}</strong><small>YDS</small></span>
        <span className="ladder-track" aria-hidden="true">
          {spread && spread.count > 1 ? (
            <span className="ladder-spread" style={{ left: pct(spread.min), width: `calc(${pct(spread.max)} - ${pct(spread.min)})` }} />
          ) : null}
          <span className="ladder-fill" style={{ width: pct(club.carryYds) }} />
        </span>
      </button>
      {open ? <ClubEditor golferId={golferId} club={club} canRemove={canRemove} /> : null}
    </li>
  );
}

function ClubEditor({ golferId, club, canRemove }: { golferId: string; club: Club; canRemove: boolean }) {
  const spread = shotSpread(club.shots ?? []);
  const commit = (yds: number) => saveBag(golferId, setCarry(readBag(golferId), club.id, yds));

  return (
    <div className="club-editor">
      <div className="carry-stepper">
        <button type="button" onClick={() => commit(club.carryYds - 5)} disabled={club.carryYds <= MIN_CARRY_YDS} aria-label={`${club.label} 5 yards shorter`}>−5</button>
        <button type="button" onClick={() => commit(club.carryYds - 1)} disabled={club.carryYds <= MIN_CARRY_YDS} aria-label={`${club.label} 1 yard shorter`}>−1</button>
        {/* Keyed on the saved number so the steppers and the field never disagree. */}
        <CarryField key={club.carryYds} label={club.label} value={club.carryYds} onCommit={commit} />
        <button type="button" onClick={() => commit(club.carryYds + 1)} disabled={club.carryYds >= MAX_CARRY_YDS} aria-label={`${club.label} 1 yard longer`}>+1</button>
        <button type="button" onClick={() => commit(club.carryYds + 5)} disabled={club.carryYds >= MAX_CARRY_YDS} aria-label={`${club.label} 5 yards longer`}>+5</button>
      </div>

      {spread ? (
        <div className="club-range">
          <span><small>RANGE MEDIAN</small><strong>{spread.median}</strong></span>
          <span><small>SPREAD</small><strong>{spread.min}–{spread.max}</strong></span>
          <span><small>SHOTS</small><strong>{spread.count}</strong></span>
          {spread.median !== club.carryYds ? (
            <button type="button" className="club-range-use" onClick={() => commit(spread.median)}>Use {spread.median}</button>
          ) : (
            <em className="club-range-match"><CheckCircle size={15} weight="fill" /> In use</em>
          )}
        </div>
      ) : (
        <p className="club-editor-note">Hit it in a range session and the median of your shots is one tap away.</p>
      )}

      <button
        type="button"
        className="club-remove"
        disabled={!canRemove}
        onClick={() => saveBag(golferId, removeClub(readBag(golferId), club.id))}
      >
        <Trash size={14} /> Take {club.label.toLowerCase()} out of the bag
      </button>
    </div>
  );
}

function CarryField({ label, value, onCommit }: { label: string; value: number; onCommit: (yds: number) => void }) {
  const [draft, setDraft] = useState(String(value));

  function commit() {
    const yds = Number.parseInt(draft, 10);
    if (Number.isFinite(yds) && yds !== value) onCommit(yds);
    else setDraft(String(value));
  }

  return (
    <label className="carry-field">
      <input
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label={`${label} carry in yards`}
        value={draft}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value.replace(/\D/g, "").slice(0, 3))}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      <small>YDS CARRY</small>
    </label>
  );
}

function AddClubs({ bag, onAdd }: { bag: Bag; onAdd: (clubId: string) => void }) {
  const inBag = new Set(bag.clubs.map((club) => club.id));
  const slotsLeft = Math.max(0, MAX_CLUBS - bag.clubs.length);
  const groups = KIND_GROUPS.map((group) => ({
    ...group,
    options: CLUB_CATALOG.filter((entry) => entry.kind === group.kind && !inBag.has(entry.id)),
  })).filter((group) => group.options.length > 0);

  if (groups.length === 0) return null;

  return (
    <section className="clubs-add">
      <div className="section-heading tight">
        <h2>Add a club</h2>
        <span>{slotsLeft} {slotsLeft === 1 ? "SLOT" : "SLOTS"} LEFT</span>
      </div>
      {slotsLeft === 0 ? (
        <p className="clubs-full">Thirteen clubs and a putter make fourteen, the most the rules allow. Take one out to add another.</p>
      ) : (
        <p className="clubs-add-note">New clubs start at a carry scaled to the rest of your bag. Fine-tune it, or hit it at the range.</p>
      )}
      <div className="add-groups">
        {groups.map((group) => (
          <div className="add-group" key={group.kind}>
            <small>{group.label.toUpperCase()}</small>
            <div className="add-chips">
              {group.options.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={`add-chip kind-${entry.kind}`}
                  disabled={slotsLeft === 0}
                  onClick={() => onAdd(entry.id)}
                >
                  <Plus size={12} weight="bold" /> {entry.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ResetBag({ golferId }: { golferId: string }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button type="button" className="clubs-reset" onClick={() => setConfirming(true)}>
        <ArrowCounterClockwise size={14} /> Reset to the default bag
      </button>
    );
  }
  return (
    <div className="clubs-reset confirming" role="group" aria-label="Reset the bag">
      <p>Go back to the standard thirteen clubs at average carries? Range shots for those clubs are kept.</p>
      <div>
        <button type="button" onClick={() => { resetBag(golferId); setConfirming(false); }}>Reset bag</button>
        <button type="button" onClick={() => setConfirming(false)}>Keep my bag</button>
      </div>
    </div>
  );
}
