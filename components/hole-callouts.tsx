import type { ReactNode } from "react";
import { ThumbsUp, TrendDown } from "@phosphor-icons/react";
import { MIN_SAMPLES } from "@/lib/personal-baseline";
import type { ReportFact } from "@/lib/round-report";
import type { ScorecardHole } from "@/lib/round-scorecard";
import { averageLabel, formatAverage, formatVsAverage, type HoleCallouts as Callouts } from "@/lib/round-story";

/**
 * Where you gained and lost against your own game. Holes that were a stroke or more away from
 * your average lead, ranked by how far; the par-based facts from the round report follow.
 * Before there is history to compare with, the facts stand on their own.
 */
export function HoleCallouts({
  callouts,
  wentWell,
  costYou,
  scored,
}: {
  callouts: Callouts;
  wentWell: ReportFact[];
  costYou: ReportFact[];
  scored: boolean;
}) {
  const compared = callouts.compared > 0;
  return (
    <section className="round-report" aria-label="What went well and what cost you">
      <CalloutCard
        tone="good"
        title="Went well"
        icon={<ThumbsUp size={17} weight="fill" />}
        holes={callouts.wentWell}
        facts={wentWell}
        compared={compared}
        emptyHoles="No hole beat your average by a stroke or more today."
        emptyFacts="No scores on the card yet."
        note={!compared && scored ? `Holes are compared with your own average once you’ve played them ${MIN_SAMPLES} times.` : null}
      />
      <CalloutCard
        tone="bad"
        title="Cost you"
        icon={<TrendDown size={17} weight="bold" />}
        holes={callouts.costYou}
        facts={costYou}
        compared={compared}
        emptyHoles="No hole went more than a stroke over your average."
        emptyFacts="Nothing expensive out there. Suspiciously tidy."
        note={null}
      />
    </section>
  );
}

function CalloutCard({
  tone,
  title,
  icon,
  holes,
  facts,
  compared,
  emptyHoles,
  emptyFacts,
  note,
}: {
  tone: "good" | "bad";
  title: string;
  icon: ReactNode;
  holes: ScorecardHole[];
  facts: ReportFact[];
  compared: boolean;
  emptyHoles: string;
  emptyFacts: string;
  note: string | null;
}) {
  // Once holes are measured against your average, the par-based facts become a short supporting list.
  const shownFacts = facts.slice(0, compared ? 2 : 4);
  return (
    <div className={`report-card ${tone} surface-card`}>
      <h2>{icon} {title}</h2>
      {compared ? (
        holes.length ? (
          <ol className="callout-list">
            {holes.map((line) => <CalloutRow key={line.hole.number} line={line} />)}
          </ol>
        ) : (
          <p className="report-empty">{emptyHoles}</p>
        )
      ) : null}
      {shownFacts.length ? (
        <>
          {compared ? <h3 className="report-subhead">Also on the card</h3> : null}
          <ul>{shownFacts.map((fact) => <li key={fact.key}>{fact.text}</li>)}</ul>
        </>
      ) : !compared ? (
        <p className="report-empty">{emptyFacts}</p>
      ) : null}
      {note ? <p className="report-note">{note}</p> : null}
    </div>
  );
}

function CalloutRow({ line }: { line: ScorecardHole }) {
  const delta = line.vsAverage ?? 0;
  return (
    <li className="callout">
      <span className="callout-hole" aria-hidden="true"><small>HOLE</small><strong>{line.hole.number}</strong></span>
      <span className="callout-body">
        <strong><span className="visually-hidden">Hole {line.hole.number}: </span>{line.score} today</strong>
        <small>{averageLabel(line)} {formatAverage(line.history?.baseline?.average ?? 0)} · Par {line.par}</small>
      </span>
      <span className={`callout-delta ${delta < 0 ? "under" : "over"}`}>
        <strong>{formatVsAverage(delta)}</strong>
        <small>vs you</small>
      </span>
    </li>
  );
}
