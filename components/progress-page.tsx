"use client";

import Link from "next/link";
import { ArrowRight, ChartLineUp, FlagPennant, Gauge, Medal, TrendUp } from "@phosphor-icons/react";
import { useGolfData } from "@/hooks/use-golf-data";
import { estimateHandicap, formatToPar, scoringAverage, summarizeRound } from "@/lib/metrics";

export function ProgressPage() {
  const data = useGolfData();
  const completed = data.rounds.filter((round) => round.status === "completed");
  const summaries = completed.map(summarizeRound).filter((round) => round.holesPlayed > 0);
  const handicap = estimateHandicap(completed);
  const average = scoringAverage(completed);
  const best = [...summaries].sort((a, b) => a.toPar - b.toPar)[0];
  const averageToPar = summaries.length
    ? summaries.reduce((sum, round) => sum + (round.toPar / round.holesPlayed) * 18, 0) / summaries.length
    : null;
  const holesLogged = summaries.reduce((sum, round) => sum + round.holesPlayed, 0);

  return (
    <div className="page-shell progress-page">
      <section className="progress-hero">
        <p className="eyebrow"><span /> YOUR GAME, IN FOCUS</p>
        <div className="progress-title-row"><div><h1>Progress</h1><p>The honest shape of your game, one round at a time.</p></div><ChartLineUp size={42} weight="duotone" /></div>
      </section>

      {completed.length === 0 ? (
        <section className="empty-progress surface-card">
          <div className="empty-mark"><FlagPennant size={34} weight="fill" /></div>
          <p className="eyebrow">YOUR BASELINE AWAITS</p>
          <h2>Finish one round to start seeing your game.</h2>
          <p>Scores, trends, best rounds, and a handicap estimate will appear here automatically.</p>
          <Link href="/play" className="primary-button">Start your first round <ArrowRight size={18} /></Link>
        </section>
      ) : (
        <>
          <section className="handicap-card surface-card">
            <div><p className="eyebrow">ESTIMATED INDEX</p><strong>{handicap?.toFixed(1) ?? "—"}</strong><span>HANDICAP TREND</span></div>
            <div className="handicap-copy"><TrendUp size={25} weight="bold" /><p><strong>Your baseline is taking shape.</strong> This estimate improves as you add complete scorecards.</p></div>
          </section>

          <section className="metric-grid">
            <Metric icon={<Gauge size={20} />} label="Scoring avg." value={average?.toFixed(1) ?? "—"} note="18-hole pace" />
            <Metric icon={<Medal size={20} />} label="Best round" value={best ? formatToPar(best.toPar) : "—"} note={best?.segment ?? "No rounds"} />
            <Metric icon={<FlagPennant size={20} />} label="Rounds" value={String(completed.length)} note={`${holesLogged} ${holesLogged === 1 ? "hole" : "holes"} logged`} />
            <Metric icon={<TrendUp size={20} />} label="Avg. to par" value={averageToPar == null ? "—" : formatToPar(Math.round(averageToPar))} note="18-hole pace" />
          </section>

          <section className="trend-card surface-card">
            <div className="section-heading"><div><p className="eyebrow">FORM</p><h2>Recent rounds</h2></div><span>TO PAR</span></div>
            <div className="trend-bars">
              {summaries.slice(0, 6).reverse().map((round) => {
                const height = Math.max(18, Math.min(100, 22 + Math.abs(round.toPar) * 7));
                return <div key={round.id} className="trend-column"><span>{formatToPar(round.toPar)}</span><i style={{ height: `${height}px` }} /><small>{new Date(round.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</small></div>;
              })}
            </div>
          </section>

          <section className="history-section">
            <div className="section-heading"><div><p className="eyebrow">HISTORY</p><h2>Round log</h2></div></div>
            <div className="round-list">
              {summaries.map((round) => (
                <article key={round.id} className="round-list-item">
                  <span className="round-date"><strong>{new Date(round.date).getDate()}</strong><small>{new Date(round.date).toLocaleDateString("en-US", { month: "short" }).toUpperCase()}</small></span>
                  <span className="round-info"><strong>{round.courseName}</strong><small>{round.segment} · {round.holesPlayed} holes</small></span>
                  <span className="round-score"><strong>{round.total}</strong><small>{formatToPar(round.toPar)}</small></span>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
      <p className="metric-disclaimer">Handicap is an informal trend estimate, not an official USGA Handicap Index.</p>
    </div>
  );
}

function Metric({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: string; note: string }) {
  return <article className="metric-card"><span>{icon}</span><small>{label}</small><strong>{value}</strong><p>{note}</p></article>;
}
