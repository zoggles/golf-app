"use client";

import { Fragment, useState } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { formatToPar } from "@/lib/metrics";
import { MIN_SAMPLES } from "@/lib/personal-baseline";
import { SCORE_TYPE_NAMES } from "@/lib/round-report";
import type { RoundScorecard as ScorecardData, ScorecardHole, ScorecardNine, ScorecardTotals } from "@/lib/round-scorecard";
import { EVEN_BAND, formatAverage, formatVsAverage, toneOf, type Tone } from "@/lib/round-story";
import type { HoleMetrics } from "@/lib/types";

type Lens = "you" | "handicap" | "par";

const LENSES: Array<{ id: Lens; label: string; unavailable: string }> = [
  { id: "you", label: "vs You", unavailable: `Unlocks once you’ve played these holes ${MIN_SAMPLES} times` },
  { id: "handicap", label: "vs Handicap", unavailable: "Needs a finished round before this one to set your handicap" },
  { id: "par", label: "vs Par", unavailable: "" },
];

const HEADINGS: Record<Lens, { expected: string | null; vs: string }> = {
  you: { expected: "Your avg", vs: "vs You" },
  handicap: { expected: "Target", vs: "vs Target" },
  par: { expected: null, vs: "vs Par" },
};

type Comparable = Pick<ScorecardTotals, "vsAverage" | "vsTarget" | "vsPar">;

function compare(lens: Lens, item: Comparable): { text: string; tone: Tone | null } {
  if (lens === "you") {
    return item.vsAverage === null
      ? { text: "—", tone: null }
      : { text: formatVsAverage(item.vsAverage), tone: toneOf(item.vsAverage, EVEN_BAND) };
  }
  const value = lens === "handicap" ? item.vsTarget : item.vsPar;
  return value === null ? { text: "—", tone: null } : { text: formatToPar(value), tone: toneOf(value) };
}

/**
 * The round hole by hole, read through one lens at a time.
 *
 * "vs You" leads once there is history, because for a beginner it is the comparison that shows
 * progress; handicap and par stay a tap away and are never mixed into it. A row opens to show
 * everything known about its hole, so the table stays five columns wide on a phone.
 */
export function RoundScorecard({ card, metricsByHole }: { card: ScorecardData; metricsByHole: Record<number, HoleMetrics> }) {
  const available: Record<Lens, boolean> = { you: card.comparedHoles > 0, handicap: card.roundHandicap !== null, par: true };
  const [picked, setPicked] = useState<Lens | null>(null);
  const lens: Lens = picked && available[picked] ? picked : available.you ? "you" : available.handicap ? "handicap" : "par";
  const [openHole, setOpenHole] = useState<number | null>(null);
  const toggleHole = (holeNumber: number) => setOpenHole((current) => (current === holeNumber ? null : holeNumber));
  const borrowed = card.nines.some((nine) => nine.holes.some((line) => line.history?.baseline?.source === "par-type"));

  return (
    <section className="scorecard surface-card" aria-label="Scorecard">
      <div className="scorecard-head">
        <h2>Scorecard</h2>
        <div className="lens-toggle" role="group" aria-label="Compare each hole with">
          {LENSES.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={lens === item.id}
              disabled={!available[item.id]}
              title={available[item.id] ? undefined : item.unavailable}
              onClick={() => setPicked(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <p className="scorecard-note">{lensNote(lens, card)}</p>

      <div className={card.nines.length > 1 ? "scorecard-nines two" : "scorecard-nines"}>
        {card.nines.map((nine) => (
          <NineTable
            key={nine.label}
            nine={nine}
            lens={lens}
            openHole={openHole}
            onToggle={toggleHole}
            metricsByHole={metricsByHole}
          />
        ))}
      </div>

      {card.nines.length > 1 ? <TotalRow totals={card} lens={lens} /> : null}

      <div className="scorecard-legend">
        <span><i className="legend-mark circle" aria-hidden="true" /> Under par</span>
        <span><i className="legend-mark square" aria-hidden="true" /> Over par</span>
        {lens === "handicap" && card.roundHandicap ? <span><i className="legend-swatch" aria-hidden="true" /> A stroke from your handicap</span> : null}
        {lens === "you" && borrowed ? <span><i className="legend-borrowed" aria-hidden="true">~</i> Your average for holes of that par, until you’ve played the hole {MIN_SAMPLES} times</span> : null}
      </div>
    </section>
  );
}

function lensNote(lens: Lens, card: ScorecardData): string {
  if (lens === "you") {
    return "Your avg is what you usually take on each hole, from your recent plays of it. Negative is better than usual. Tap a hole for your best and last score there.";
  }
  if (lens === "handicap") {
    const index = card.handicapIndex?.toFixed(1) ?? "—";
    if (!card.roundHandicap) return `Your ${index} handicap going into this round gave no strokes here, so each target is par.`;
    return `Target is par plus the ${card.roundHandicap} ${card.roundHandicap === 1 ? "stroke" : "strokes"} your ${index} handicap gave you going into this round, hardest holes first.`;
  }
  return "Par is what the course expects of any golfer.";
}

function NineTable({
  nine,
  lens,
  openHole,
  onToggle,
  metricsByHole,
}: {
  nine: ScorecardNine;
  lens: Lens;
  openHole: number | null;
  onToggle: (holeNumber: number) => void;
  metricsByHole: Record<number, HoleMetrics>;
}) {
  const headings = HEADINGS[lens];
  const columns = headings.expected ? 5 : 4;
  const totals = compare(lens, nine);

  return (
    <table className={`scorecard-table lens-${lens}`}>
      <caption className="visually-hidden">{nine.label === "Out" ? "Front nine" : "Back nine"}</caption>
      <thead>
        <tr>
          <th scope="col">Hole</th>
          <th scope="col">Par</th>
          {headings.expected ? <th scope="col">{headings.expected}</th> : null}
          <th scope="col">Today</th>
          <th scope="col">{headings.vs}</th>
        </tr>
      </thead>
      <tbody>
        {nine.holes.map((line) => {
          const open = openHole === line.hole.number;
          const result = compare(lens, line);
          const detailId = `hole-detail-${line.hole.number}`;
          return (
            <Fragment key={line.hole.number}>
              <tr className={open ? "is-open" : undefined}>
                <th scope="row">
                  <button
                    type="button"
                    className="hole-toggle"
                    aria-expanded={open}
                    aria-controls={open ? detailId : undefined}
                    aria-label={`Hole ${line.hole.number}, ${open ? "hide" : "show"} details`}
                    onClick={() => onToggle(line.hole.number)}
                  >
                    {line.hole.number}
                    <CaretDown size={10} weight="bold" aria-hidden="true" />
                  </button>
                </th>
                <td className="col-par">{line.par}</td>
                {lens === "you" ? <AverageCell line={line} /> : null}
                {lens === "handicap" ? (
                  <td
                    className={line.strokesReceived ? "col-expected gets-stroke" : "col-expected"}
                    title={line.strokesReceived ? `+${line.strokesReceived} from your handicap` : undefined}
                  >
                    {line.target ?? "—"}
                  </td>
                ) : null}
                <td
                  className="col-today"
                  aria-label={line.score === null || !line.type ? "No score" : `${line.score}, ${SCORE_TYPE_NAMES[line.type].single}`}
                >
                  {line.score === null || !line.type ? "—" : <span className={`score-mark ${line.type}`}>{line.score}</span>}
                </td>
                <td className={`col-vs ${result.tone ?? ""}`}>{result.text}</td>
              </tr>
              {open ? (
                <tr className="scorecard-detail" id={detailId}>
                  <td colSpan={columns}><HoleDetail line={line} metrics={metricsByHole[line.hole.number]} /></td>
                </tr>
              ) : null}
            </Fragment>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">{nine.label}</th>
          <td className="col-par">{nine.par}</td>
          {lens === "you" ? <td className="col-expected">{nine.average === null ? "—" : formatAverage(nine.average)}</td> : null}
          {lens === "handicap" ? <td className="col-expected">{nine.target ?? "—"}</td> : null}
          <td className="col-today">{nine.score ?? "—"}</td>
          <td className={`col-vs ${totals.tone ?? ""}`}>{totals.text}</td>
        </tr>
      </tfoot>
    </table>
  );
}

function AverageCell({ line }: { line: ScorecardHole }) {
  const baseline = line.history?.baseline;
  if (!baseline) return <td className="col-expected" title={`Shows after ${MIN_SAMPLES} plays of this hole`}>—</td>;
  const borrowed = baseline.source === "par-type";
  return (
    <td
      className={borrowed ? "col-expected borrowed" : "col-expected"}
      title={borrowed
        ? `Your par-${line.par} average, until you’ve played this hole ${MIN_SAMPLES} times`
        : `Your average over your last ${baseline.samples} plays`}
    >
      {formatAverage(baseline.average)}
    </td>
  );
}

function HoleDetail({ line, metrics }: { line: ScorecardHole; metrics?: HoleMetrics }) {
  const { hole, history } = line;
  const baseline = history?.baseline ?? null;
  const facts: Array<[string, string]> = [];

  if (history) {
    facts.push([
      "Your history",
      history.plays === 0
        ? "First time playing this hole"
        : `Played ${history.plays} ${history.plays === 1 ? "time" : "times"} before · Best ${history.best} · Last ${history.last}`,
    ]);
    facts.push([
      "Your avg",
      baseline === null
        ? `Shows after ${MIN_SAMPLES} plays of this hole`
        : baseline.source === "hole"
          ? `${formatAverage(baseline.average)} over your last ${baseline.samples} plays`
          : `${formatAverage(baseline.average)}, from your last ${baseline.samples} par-${line.par} holes anywhere`,
    ]);
  }
  facts.push([
    "Handicap",
    line.target === null
      ? "No handicap target yet"
      : `Target ${line.target} · ${line.strokesReceived ? `+${line.strokesReceived} from your handicap` : "no stroke here"} · Hole HCP ${hole.handicap}`,
  ]);
  facts.push(["Hole", `Par ${line.par}${hole.yards ? ` · ${hole.yards} yds` : ""}`]);

  const tracked: string[] = [];
  if (metrics?.fairway) tracked.push(`Fairway ${metrics.fairway}`);
  if (metrics?.putts !== undefined) tracked.push(`${metrics.putts} ${metrics.putts === 1 ? "putt" : "putts"}`);
  if (metrics?.penaltyStrokes !== undefined) tracked.push(`${metrics.penaltyStrokes} ${metrics.penaltyStrokes === 1 ? "penalty" : "penalties"}`);
  if (tracked.length) facts.push(["Tracked", tracked.join(" · ")]);

  return (
    <dl className="hole-detail">
      {facts.map(([term, value]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function TotalRow({ totals, lens }: { totals: ScorecardTotals; lens: Lens }) {
  const result = compare(lens, totals);
  return (
    <dl className="scorecard-total">
      <div><dt>Total par</dt><dd>{totals.par}</dd></div>
      {lens === "you" ? <div><dt>Your avg</dt><dd>{totals.average === null ? "—" : formatAverage(totals.average)}</dd></div> : null}
      {lens === "handicap" ? <div><dt>Target</dt><dd>{totals.target ?? "—"}</dd></div> : null}
      <div><dt>Today</dt><dd>{totals.score ?? "—"}</dd></div>
      <div><dt>{HEADINGS[lens].vs}</dt><dd className={result.tone ?? undefined}>{result.text}</dd></div>
    </dl>
  );
}
