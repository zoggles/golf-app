"use client";

import Link from "next/link";
import { ArrowRight, CaretRight, FileArrowDown, FlagPennant, Gauge, TrendUp } from "@phosphor-icons/react";
import { CourseTrends } from "@/components/course-trends";
import { FormatMark } from "@/components/format-mark";
import { PersonalProgressSection } from "@/components/personal-progress-section";
import { useGolfData } from "@/hooks/use-golf-data";
import { useSelectedGolfer } from "@/hooks/use-selected-golfer";
import { buildHistoryCsv, historyExportFilename } from "@/lib/history-export";
import { buildRoundInsights, estimateHandicap, estimateRoundHandicap, formatToPar, scoringAverage, summarizeRound, trackedRoundMetrics, type RoundSummary } from "@/lib/metrics";
import { buildRoundBaselines, historyBefore } from "@/lib/personal-baseline";
import { bestByFormat, describeFormatCounts } from "@/lib/round-format";
import { handicapGoingInto } from "@/lib/round-scorecard";
import { personalHeadline } from "@/lib/round-story";
import type { GolfRound, RoundSegment } from "@/lib/types";

const shortDate = (date: string) => new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function ProgressPage() {
  const data = useGolfData();
  const golferName = useSelectedGolfer()?.name ?? "Golfer";
  const completed = data.rounds.filter((round) => round.status === "completed");
  // Sorted here rather than trusting the stored order, so correcting a round's
  // date moves it in the log straight away.
  const summaries = completed
    .map(summarizeRound)
    .filter((round) => round.holesPlayed > 0)
    .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());
  const handicap = estimateHandicap(completed);
  const roundsById = new Map(completed.map((round) => [round.id, round]));
  // A summary carries only a display label for its segment; the saved round has the real one.
  const segmentOf = (roundId: string): RoundSegment => roundsById.get(roundId)?.segment ?? "front9";
  const insightsByRound = buildRoundInsights(completed);
  const average = scoringAverage(completed);
  const best = bestByFormat(summaries);
  const averageToPar = summaries.length
    ? summaries.reduce((sum, round) => sum + (round.toPar / round.holesPlayed) * 18, 0) / summaries.length
    : null;
  const holesLogged = summaries.reduce((sum, round) => sum + round.holesPlayed, 0);
  const formatCounts = describeFormatCounts(summaries);
  const bestNote = (round: RoundSummary | null, format: string) =>
    round ? `${round.courseName} · ${shortDate(round.date)}` : `No ${format} rounds yet`;

  return (
    <div className="page-shell progress-page">
      <section className="progress-hero">
        <div className="progress-title-row">
          <div><h1>Progress</h1><p>{completed.length} completed {completed.length === 1 ? "round" : "rounds"}</p></div>
          <ExportHistoryButton rounds={data.rounds} golferName={golferName} />
        </div>
      </section>

      {completed.length === 0 ? (
        <section className="empty-progress surface-card">
          <div className="empty-mark"><FlagPennant size={34} weight="fill" /></div>
          <h2>No completed rounds</h2>
          <p>Complete a round to calculate scoring and handicap metrics.</p>
          <Link href="/play" className="primary-button">New round <ArrowRight size={18} /></Link>
        </section>
      ) : (
        <>
          <section className="handicap-card surface-card">
            <div><p className="eyebrow">ESTIMATED HANDICAP INDEX</p><strong>{handicap?.toFixed(1) ?? "—"}</strong><span>INFORMAL ESTIMATE</span></div>
            <div className="handicap-copy"><TrendUp size={25} weight="bold" /><p>Your overall ability estimate. Each saved round also shows a tee-adjusted round handicap.</p></div>
          </section>

          <section className="metric-grid">
            <Metric icon={<Gauge size={20} />} label="Scoring avg." value={average?.toFixed(1) ?? "—"} note="18-hole pace" />
            <Metric icon={<TrendUp size={20} />} label="Avg. to par" value={averageToPar == null ? "—" : formatToPar(Math.round(averageToPar))} note="18-hole pace" />
            <Metric
              icon={<FormatMark segment="front9" holesPlayed={9} label="none" />}
              label="Best 9"
              value={best.nine ? formatToPar(best.nine.toPar) : "—"}
              note={bestNote(best.nine, "9-hole")}
            />
            <Metric
              icon={<FormatMark segment="full18" holesPlayed={18} label="none" />}
              label="Best 18"
              value={best.eighteen ? formatToPar(best.eighteen.toPar) : "—"}
              note={bestNote(best.eighteen, "18-hole")}
            />
            <Metric icon={<FlagPennant size={20} />} label="Rounds" value={String(completed.length)} note={formatCounts ?? `${holesLogged} ${holesLogged === 1 ? "hole" : "holes"} logged`} />
          </section>

          <CourseTrends rounds={completed} />

          <PersonalProgressSection rounds={completed} />

          <section className="history-section">
            <div className="section-heading"><div><h2>Round log</h2><p>Strengths and focus areas use only the stats you tracked, compared with your own rounds.</p></div></div>
            <div className="round-list">
              {summaries.map((round) => {
                const savedRound = roundsById.get(round.id);
                // The handicap carried into each round, matching what that round’s own page shows.
                const roundHandicap = savedRound ? estimateRoundHandicap(handicapGoingInto(completed, savedRound), savedRound.course, savedRound.segment) : null;
                const insights = insightsByRound.get(round.id) ?? [];
                const facts = savedRound ? metricFacts(savedRound).slice(0, insights.length ? 0 : 2) : [];
                // The same "vs you" the round's own page leads with, measured against the rounds before it.
                const vsYou = savedRound
                  ? personalHeadline(buildRoundBaselines(historyBefore(completed, savedRound), savedRound), savedRound.course.shortName)
                  : null;
                return (
                  <Link key={round.id} href={`/rounds/${round.id}`} className="round-list-item" aria-label={`Open ${round.courseName} round from ${new Date(round.date).toLocaleDateString()}`}>
                    <span className="round-date"><strong>{new Date(round.date).getDate()}</strong><small>{new Date(round.date).toLocaleDateString("en-US", { month: "short" }).toUpperCase()}</small></span>
                    <span className="round-info">
                      <strong>{round.courseName}</strong>
                      <small>{savedRound?.tee ? `${savedRound.tee} tees · ` : ""}Round HCP {roundHandicap ?? "—"}</small>
                      {insights.length || facts.length ? (
                        <span className="round-insights">
                          {insights.map((insight) => <small key={`${insight.tone}-${insight.text}`} className={`round-insight ${insight.tone}`}>{insight.tone === "strength" ? "Best" : "Focus"} · {insight.text}</small>)}
                          {facts.map((fact) => <small key={fact} className="round-insight neutral">Tracked · {fact}</small>)}
                        </span>
                      ) : null}
                    </span>
                    <span className="round-score">
                      <FormatMark segment={segmentOf(round.id)} holesPlayed={round.holesPlayed} />
                      <span className="round-score-line"><strong>{round.total}</strong><small>{formatToPar(round.toPar)}</small></span>
                      {vsYou?.value ? <small className={`round-vs-you ${vsYou.tone ?? ""}`} title={vsYou.title}>{vsYou.value} vs avg</small> : null}
                    </span>
                    <CaretRight className="round-open-icon" size={18} />
                  </Link>
                );
              })}
            </div>
          </section>
        </>
      )}
      <p className="metric-disclaimer">Handicap is an informal trend estimate, not an official USGA Handicap Index.</p>
    </div>
  );
}

function metricFacts(round: GolfRound): string[] {
  const tracked = trackedRoundMetrics(round);
  const facts: string[] = [];
  if (tracked.fairwaysTracked) facts.push(`${Math.round((tracked.fairwaysHit / tracked.fairwaysTracked) * 100)}% fairways`);
  if (tracked.puttsHoles) facts.push(`${tracked.puttsTotal} putts over ${tracked.puttsHoles} ${tracked.puttsHoles === 1 ? "hole" : "holes"}`);
  if (tracked.penaltyHoles) facts.push(`${tracked.penaltyStrokes} penalty ${tracked.penaltyStrokes === 1 ? "stroke" : "strokes"}`);
  if (tracked.scoredHoles) facts.push(`${tracked.blowUpHoles} blow-up ${tracked.blowUpHoles === 1 ? "hole" : "holes"}`);
  return facts;
}

/**
 * Downloads every stored round as a spreadsheet, one row per hole. The file is
 * built in the browser from the same mirror the page is reading, so it works on
 * the course with no signal.
 */
function ExportHistoryButton({ rounds, golferName }: { rounds: GolfRound[]; golferName: string }) {
  function download() {
    // The byte order mark is what makes Excel read the file as UTF-8, so course
    // names keep their dashes and accents.
    const blob = new Blob(["\uFEFF", buildHistoryCsv(rounds, golferName)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = historyExportFilename(golferName, new Date());
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      className="secondary-button export-button"
      type="button"
      onClick={download}
      disabled={rounds.length === 0}
      title={`Download every round ${golferName} has logged as a CSV spreadsheet, one row per hole`}
    >
      <FileArrowDown size={18} /> Export round history
    </button>
  );
}

function Metric({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: string; note: string }) {
  return <article className="metric-card"><span>{icon}</span><small>{label}</small><strong>{value}</strong><p>{note}</p></article>;
}
