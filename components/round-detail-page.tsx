"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowClockwise,
  ArrowLeft,
  Check,
  MapPin,
  Minus,
  PencilSimple,
  Plus,
  Sparkle,
  Spinner,
  ThumbsUp,
  Trash,
  TrendDown,
  TrendUp,
  WarningCircle,
} from "@phosphor-icons/react";
import { FormatMark } from "@/components/format-mark";
import { PersonalScorecard } from "@/components/personal-scorecard";
import { useGolfData } from "@/hooks/use-golf-data";
import { useRoundSummary, type SummaryState } from "@/hooks/use-round-summary";
import { getSegmentHoles } from "@/lib/courses";
import { estimateRoundHandicap, formatToPar, handicapStrokesForHole, holeMetricsByNumber, trackedRoundMetrics } from "@/lib/metrics";
import { buildPersonalScorecard, describeVsYourPar, handicapGoingInto } from "@/lib/personal-par";
import {
  buildRoundReport,
  buildSummaryInput,
  compareToPrevious,
  previousCompletedRounds,
  roundSummaryFingerprint,
  SCORE_TYPE_NAMES,
  SCORE_TYPES,
  scoreType,
} from "@/lib/round-report";
import { dateInputValue, parseDateInput, roundDateInputValue } from "@/lib/round-date";
import { deleteRound, updateCompletedRound } from "@/lib/storage";
import type { GolfRound } from "@/lib/types";

/** Below this there isn’t enough golf on the card to say anything fair about it. */
const SUMMARY_MIN_HOLES = 9;

export function RoundDetailPage({ roundId }: { roundId: string }) {
  const data = useGolfData();
  const round = data.rounds.find((item) => item.id === roundId);

  if (!round) {
    return (
      <div className="page-shell round-detail-page">
        <Link className="back-link" href="/progress"><ArrowLeft size={17} /> Progress</Link>
        <section className="not-found-card surface-card"><h1>Round not found</h1><p>This round may have been deleted or saved in another browser.</p></section>
      </div>
    );
  }

  // The handicap carried into this round, not today's, so an old round keeps the expectation
  // it was actually played under.
  return <RoundEditor key={round.id} round={round} rounds={data.rounds} handicapIndex={handicapGoingInto(data.rounds, round)} />;
}

function RoundEditor({ round, rounds, handicapIndex }: { round: GolfRound; rounds: GolfRound[]; handicapIndex: number | null }) {
  const router = useRouter();
  const course = round.course;
  const holes = useMemo(() => getSegmentHoles(course, round.segment), [course, round.segment]);
  const [scores, setScores] = useState<Record<number, number>>(() => ({ ...round.scores }));
  const [playedOn, setPlayedOn] = useState(() => roundDateInputValue(round));
  const [saved, setSaved] = useState(false);
  // Corrections are the rare case on an old round, so the editor stays out of the way until asked.
  const [editing, setEditing] = useState(false);
  const scoresChanged = holes.some((hole) => scores[hole.number] !== round.scores[hole.number]);
  const dateChanged = playedOn !== roundDateInputValue(round);
  const isDirty = scoresChanged || dateChanged;
  // The header reads back what is about to be saved, not what is stored.
  const shownDate = parseDateInput(playedOn) ?? new Date(round.completedAt ?? round.startedAt);
  const total = holes.reduce((sum, hole) => sum + (scores[hole.number] ?? 0), 0);
  const par = holes.reduce((sum, hole) => sum + hole.par, 0);
  const roundHandicap = estimateRoundHandicap(handicapIndex, course, round.segment);
  const metricsByHole = holeMetricsByNumber(round);
  const tracked = trackedRoundMetrics(round);
  const hasTrackedStats = tracked.puttsHoles > 0 || tracked.penaltyHoles > 0 || tracked.fairwaysTracked > 0;

  const card = useMemo(() => buildPersonalScorecard({ round, handicapIndex, scores }), [round, handicapIndex, scores]);
  const personalTone = card.vsYourPar === null ? null : card.vsYourPar < 0 ? "under" : card.vsYourPar > 0 ? "over" : "even";

  // The card and the lists follow unsaved edits, so fixing a score shows its effect at once.
  const report = useMemo(() => buildRoundReport(round, scores, { handicapIndex }), [round, scores, handicapIndex]);
  // The summary is written about what is stored, never about an edit that may be discarded.
  const savedReport = useMemo(() => buildRoundReport(round, round.scores, { handicapIndex }), [round, handicapIndex]);
  const previous = useMemo(() => previousCompletedRounds(rounds, round), [rounds, round]);
  const comparison = useMemo(
    () => compareToPrevious(savedReport, previous.map((item) => buildRoundReport(item))),
    [savedReport, previous],
  );
  const fingerprint = useMemo(() => roundSummaryFingerprint(round, previous), [round, previous]);
  const summaryInput = useMemo(() => buildSummaryInput(round, savedReport, comparison), [round, savedReport, comparison]);
  const canSummarize = savedReport.holesScored >= SUMMARY_MIN_HOLES;
  const summary = useRoundSummary({
    roundId: round.id,
    fingerprint,
    input: summaryInput,
    enabled: canSummarize && !isDirty,
  });

  function changeScore(holeNumber: number, change: number) {
    setSaved(false);
    setScores((current) => ({
      ...current,
      [holeNumber]: Math.min(20, Math.max(1, (current[holeNumber] ?? 1) + change)),
    }));
  }

  function startEditing() {
    setSaved(false);
    setEditing(true);
  }

  function cancelEditing() {
    setScores({ ...round.scores });
    setPlayedOn(roundDateInputValue(round));
    setSaved(false);
    setEditing(false);
  }

  function saveChanges() {
    updateCompletedRound(round.id, {
      scores: scoresChanged ? scores : undefined,
      playedOn: dateChanged ? playedOn : undefined,
    });
    setSaved(true);
    setEditing(false);
  }

  function removeRound() {
    if (!window.confirm("Delete this round permanently?")) return;
    deleteRound(round.id);
    router.replace("/progress");
  }

  return (
    <div className="page-shell round-detail-page">
      <Link className="back-link" href="/progress"><ArrowLeft size={17} /> Progress</Link>

      <header className="round-detail-header">
        <div>
          <p className="eyebrow">COMPLETED ROUND</p>
          <h1>{course.shortName}</h1>
          <p><MapPin size={14} /> {course.location} · {round.tee} tees · Round HCP {roundHandicap ?? "—"}</p>
          <time dateTime={playedOn}>{shownDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</time>
        </div>
        <div className="round-detail-total">
          <FormatMark segment={round.segment} holesPlayed={holes.length} />
          <small>TOTAL</small>
          <strong>{total}</strong>
          <span>{formatToPar(total - par)}</span>
          {card.vsYourPar !== null ? (
            <em className={`round-detail-personal ${personalTone}`}>{describeVsYourPar(card.vsYourPar)}</em>
          ) : null}
        </div>
      </header>

      <PersonalScorecard card={card} />

      <section className="score-mix surface-card" aria-label="Score breakdown">
        {SCORE_TYPES.map((type) => (
          <div key={type} className={report.mix[type] ? "score-mix-item" : "score-mix-item empty"}>
            <span className={`score-mark ${type}`}>{report.mix[type]}</span>
            <small>{SCORE_TYPE_NAMES[type].plural}</small>
          </div>
        ))}
      </section>

      <section className="round-report" aria-label="What went well and what cost you">
        <div className="report-card good surface-card">
          <h2><ThumbsUp size={17} weight="fill" /> Went well</h2>
          {report.wentWell.length ? (
            <ul>{report.wentWell.map((fact) => <li key={fact.key}>{fact.text}</li>)}</ul>
          ) : (
            <p className="report-empty">No scores on the card yet.</p>
          )}
        </div>
        <div className="report-card bad surface-card">
          <h2><TrendDown size={17} weight="bold" /> Cost you</h2>
          {report.costYou.length ? (
            <ul>{report.costYou.map((fact) => <li key={fact.key}>{fact.text}</li>)}</ul>
          ) : (
            <p className="report-empty">Nothing expensive out there. Suspiciously tidy.</p>
          )}
        </div>
      </section>

      {hasTrackedStats ? (
        <section className="round-tracked-summary surface-card" aria-label="Tracked on-course stats">
          {tracked.fairwaysTracked ? <div><small>FAIRWAYS</small><strong>{Math.round((tracked.fairwaysHit / tracked.fairwaysTracked) * 100)}%</strong><span>{tracked.fairwaysHit} of {tracked.fairwaysTracked}</span></div> : null}
          {tracked.puttsHoles ? <div><small>PUTTS</small><strong>{tracked.puttsTotal}</strong><span>{tracked.puttsHoles} {tracked.puttsHoles === 1 ? "hole" : "holes"} tracked</span></div> : null}
          {tracked.penaltyHoles ? <div><small>PENALTIES</small><strong>{tracked.penaltyStrokes}</strong><span>{tracked.penaltyHoles} {tracked.penaltyHoles === 1 ? "hole" : "holes"} tracked</span></div> : null}
          <div><small>BLOW-UPS</small><strong>{tracked.blowUpHoles}</strong><span>marked or triple+</span></div>
        </section>
      ) : null}

      {editing ? (
        <section className="round-editor surface-card">
          <div className="round-date-field">
            <label htmlFor="round-played-on">Date played</label>
            <input
              id="round-played-on"
              type="date"
              value={playedOn}
              max={dateInputValue(new Date())}
              onChange={(event) => {
                setSaved(false);
                setPlayedOn(event.target.value);
              }}
            />
          </div>
          <p className="round-handicap-help">Hole HCP: 1 is hardest, 18 is easiest. “+1” is a stroke allocated from your Round HCP.</p>
          <div className="round-editor-heading"><span>HOLE</span><span>PAR</span><span>HOLE HCP</span><span>YARDS</span><span>SCORE</span></div>
          {holes.map((hole) => {
            const metrics = metricsByHole[hole.number];
            const strokes = scores[hole.number];
            const mark = strokes != null ? scoreType(strokes, hole.par) : null;
            const derivedBlowUp = strokes != null && strokes >= hole.par + 3;
            return <div className="round-editor-row" key={hole.number}>
              <strong>{hole.number}</strong>
              <span>{hole.par}</span>
              <span>{hole.handicap}{handicapStrokesForHole(roundHandicap, hole, holes) ? ` · +${handicapStrokesForHole(roundHandicap, hole, holes)}` : ""}</span>
              <span>{hole.yards}</span>
              <div className="inline-score-control">
                <button type="button" onClick={() => changeScore(hole.number, -1)} aria-label={`Decrease hole ${hole.number} score`}><Minus size={16} /></button>
                <strong
                  className={mark ? `score-mark ${mark}` : undefined}
                  aria-label={mark ? `${strokes}, ${SCORE_TYPE_NAMES[mark].single}` : "No score"}
                >
                  {strokes ?? "—"}
                </strong>
                <button type="button" onClick={() => changeScore(hole.number, 1)} aria-label={`Increase hole ${hole.number} score`}><Plus size={16} /></button>
              </div>
              {metrics && Object.keys(metrics).length ? (
                <div className="round-hole-details">
                  {metrics.fairway ? <small>Fairway {metrics.fairway}</small> : null}
                  {metrics.putts !== undefined ? <small>{metrics.putts} {metrics.putts === 1 ? "putt" : "putts"}</small> : null}
                  {metrics.penaltyStrokes !== undefined ? <small>{metrics.penaltyStrokes} {metrics.penaltyStrokes === 1 ? "penalty" : "penalties"}</small> : null}
                  {metrics.blowUp || derivedBlowUp ? <small>Blow-up</small> : null}
                </div>
              ) : null}
            </div>;
          })}
        </section>
      ) : null}

      <div className="round-edit-actions">
        <button className="danger-button" type="button" onClick={removeRound}><Trash size={18} /> Delete round</button>
        <div>
          {saved ? <span className="saved-indicator"><Check size={16} /> Saved</span> : null}
          {editing ? (
            <>
              <button className="secondary-button" type="button" onClick={cancelEditing}>Cancel</button>
              <button className="primary-button" type="button" onClick={saveChanges} disabled={!isDirty}>Save changes</button>
            </>
          ) : (
            <button className="secondary-button" type="button" onClick={startEditing}><PencilSimple size={17} /> Edit scores</button>
          )}
        </div>
      </div>

      <CaddyTake
        state={summary.state}
        retry={summary.retry}
        dirty={isDirty}
        canSummarize={canSummarize}
        previousCount={comparison.previousCount}
      />
    </div>
  );
}

function CaddyTake({
  state,
  retry,
  dirty,
  canSummarize,
  previousCount,
}: {
  state: SummaryState;
  retry: () => void;
  dirty: boolean;
  canSummarize: boolean;
  previousCount: number;
}) {
  let body: ReactNode;
  if (dirty) {
    body = <p className="take-note">Save your changes and the caddy will take another look.</p>;
  } else if (!canSummarize) {
    body = <p className="take-note">The caddy weighs in once at least nine holes are on the card.</p>;
  } else if (state.status === "ready") {
    const { summary } = state;
    body = (
      <>
        <h2 className="take-headline">{summary.headline}</h2>
        {summary.improving.length ? (
          <div className="take-block good">
            <h3><TrendUp size={16} weight="bold" /> Getting better</h3>
            <ul>{summary.improving.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ul>
          </div>
        ) : null}
        <div className="take-block bad">
          <h3><TrendDown size={16} weight="bold" /> Keep working on</h3>
          <ul>{summary.workOn.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ul>
        </div>
        <p className="take-signoff">{summary.signOff}</p>
        <small className="take-footnote">
          {previousCount
            ? `Compared with your last ${previousCount} ${previousCount === 1 ? "round" : "rounds"}.`
            : "First round on the books, so this one sets the bar."}
        </small>
      </>
    );
  } else if (state.status === "error") {
    body = (
      <div className="take-error">
        <WarningCircle size={18} weight="fill" />
        <span>{state.message}</span>
        {state.retryable ? (
          <button type="button" onClick={retry}><ArrowClockwise size={15} weight="bold" /> Try again</button>
        ) : null}
      </div>
    );
  } else {
    body = <p className="take-note"><Spinner size={16} className="spin" /> Reviewing the tape…</p>;
  }

  return (
    <section className="caddy-take surface-card" aria-live="polite">
      <p className="eyebrow"><Sparkle size={13} weight="fill" /> THE CADDY’S TAKE</p>
      {body}
    </section>
  );
}
