"use client";

import Link from "next/link";
import { ArrowRight, CaretRight, FlagPennant, Gauge, Medal, TrendUp } from "@phosphor-icons/react";
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
        <div className="progress-title-row"><div><h1>Progress</h1><p>{completed.length} completed {completed.length === 1 ? "round" : "rounds"}</p></div></div>
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
            <div><p className="eyebrow">ESTIMATED INDEX</p><strong>{handicap?.toFixed(1) ?? "—"}</strong><span>INFORMAL ESTIMATE</span></div>
            <div className="handicap-copy"><TrendUp size={25} weight="bold" /><p>Based on the best differentials from your saved rounds.</p></div>
          </section>

          <section className="metric-grid">
            <Metric icon={<Gauge size={20} />} label="Scoring avg." value={average?.toFixed(1) ?? "—"} note="18-hole pace" />
            <Metric icon={<Medal size={20} />} label="Best round" value={best ? formatToPar(best.toPar) : "—"} note={best?.segment ?? "No rounds"} />
            <Metric icon={<FlagPennant size={20} />} label="Rounds" value={String(completed.length)} note={`${holesLogged} ${holesLogged === 1 ? "hole" : "holes"} logged`} />
            <Metric icon={<TrendUp size={20} />} label="Avg. to par" value={averageToPar == null ? "—" : formatToPar(Math.round(averageToPar))} note="18-hole pace" />
          </section>

          <section className="trend-card surface-card">
            <div className="section-heading"><div><h2>Recent rounds</h2></div><span>TO PAR</span></div>
            <div className="trend-bars">
              {summaries.slice(0, 6).reverse().map((round) => {
                const height = Math.max(18, Math.min(100, 22 + Math.abs(round.toPar) * 7));
                const date = new Date(round.date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
                return (
                  <Link
                    key={round.id}
                    href={`/rounds/${round.id}`}
                    className="trend-column"
                    aria-label={`Open ${round.courseName}, ${round.holesPlayed} holes, ${formatToPar(round.toPar)} to par`}
                  >
                    <span className="trend-score">{formatToPar(round.toPar)}</span>
                    <i className="trend-bar" style={{ height: `${height}px` }} />
                    <span className="trend-round-meta">
                      <strong title={round.courseName}>{round.courseName}</strong>
                      <small>{round.holesPlayed} holes · {date}</small>
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>

          <section className="history-section">
            <div className="section-heading"><div><h2>Round log</h2></div></div>
            <div className="round-list">
              {summaries.map((round) => (
                <Link key={round.id} href={`/rounds/${round.id}`} className="round-list-item" aria-label={`Open ${round.courseName} round from ${new Date(round.date).toLocaleDateString()}`}>
                  <span className="round-date"><strong>{new Date(round.date).getDate()}</strong><small>{new Date(round.date).toLocaleDateString("en-US", { month: "short" }).toUpperCase()}</small></span>
                  <span className="round-info"><strong>{round.courseName}</strong><small>{round.segment} · {round.holesPlayed} holes</small></span>
                  <span className="round-score"><strong>{round.total}</strong><small>{formatToPar(round.toPar)}</small></span>
                  <CaretRight className="round-open-icon" size={18} />
                </Link>
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
