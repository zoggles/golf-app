import { Target } from "@phosphor-icons/react";
import { formatToPar } from "@/lib/metrics";
import { SCORE_TYPE_NAMES, SCORE_TYPES, type RoundReport } from "@/lib/round-report";
import { averageLabel, formatAverage, formatVsAverage, type Opportunity, type WorstHole } from "@/lib/round-story";

/**
 * What the round says to work on: how the holes broke down, the one change that would have
 * saved the most strokes, and the hole that hurt most.
 */
export function OpportunityCard({
  report,
  opportunity,
  worst,
}: {
  report: RoundReport;
  opportunity: Opportunity | null;
  worst: WorstHole | null;
}) {
  if (!report.holesScored) return null;

  return (
    <section className="opportunity-card surface-card" aria-label="What to work on">
      <p className="eyebrow">WHAT TO WORK ON</p>

      <div className="score-mix" aria-label={`Score breakdown over ${report.holesScored} holes`}>
        {SCORE_TYPES.map((type) => (
          <div key={type} className={report.mix[type] ? "score-mix-item" : "score-mix-item empty"}>
            <span className={`score-mark ${type}`}>{report.mix[type]}</span>
            <small>{SCORE_TYPE_NAMES[type].plural}</small>
          </div>
        ))}
      </div>

      {opportunity ? (
        <div className="opportunity">
          <small>BIGGEST OPPORTUNITY</small>
          <h2><Target size={20} weight="bold" /> {opportunity.title}</h2>
          <p>{opportunity.detail}</p>
          <p className="opportunity-next"><strong>Next round</strong> {opportunity.next}</p>
        </div>
      ) : (
        <div className="opportunity quiet">
          <small>BIGGEST OPPORTUNITY</small>
          <p>No single change would have saved more than a stroke today. Keep doing what you’re doing.</p>
        </div>
      )}

      {worst ? (
        <div className="worst-hole">
          <span className="callout-hole" aria-hidden="true"><small>HOLE</small><strong>{worst.line.hole.number}</strong></span>
          <span className="worst-hole-body">
            <small>HURT MOST</small>
            <strong><span className="visually-hidden">Hole {worst.line.hole.number}: </span>{worst.line.score} on a par {worst.line.par}</strong>
            <span>
              {worst.basis === "average"
                ? `${averageLabel(worst.line)} ${formatAverage(worst.line.history?.baseline?.average ?? 0)}`
                : `${worst.delta} over par`}
            </span>
          </span>
          <span className="callout-delta over">
            <strong>{worst.basis === "average" ? formatVsAverage(worst.delta) : formatToPar(worst.delta)}</strong>
            <small>{worst.basis === "average" ? "vs you" : "vs par"}</small>
          </span>
        </div>
      ) : null}
    </section>
  );
}
