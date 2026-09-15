"use client";

import { useState } from "react";
import Link from "next/link";
import { courseTrends } from "@/lib/course-trends";
import { formatToPar } from "@/lib/metrics";
import { describeTrend } from "@/lib/personal-baseline";
import { formatLabel } from "@/lib/round-format";
import type { GolfRound } from "@/lib/types";

export function CourseTrends({ rounds }: { rounds: GolfRound[] }) {
  const groups = courseTrends(rounds);
  const [selected, setSelected] = useState("");
  const group = groups.find((item) => item.key === selected) ?? groups[0];
  if (!group) return <section className="trend-card surface-card"><h2>Progress by course</h2><p>Finish scoring every hole of a round to start your course history.</p></section>;
  const { points } = group;
  const low = Math.min(...points.map((point) => point.total)) - 2;
  const high = Math.max(...points.map((point) => point.total)) + 2;
  const x = (index: number) => points.length === 1 ? 50 : 5 + index * 90 / (points.length - 1);
  const y = (score: number) => 10 + (high - score) / (high - low) * 80;
  const last = points[points.length - 1];
  const change = last.total - points[0].total;
  return (
    <section className="trend-card surface-card course-history">
      <div className="section-heading"><div><h2>Progress by course</h2><p>See how your scores change on the same course, from the same tees and holes.</p></div></div>
      <label htmlFor="course-history-choice">Course, tees and holes</label>
      <select id="course-history-choice" className="course-select" value={group.key} onChange={(event) => setSelected(event.target.value)}>
        {groups.map((item) => <option key={item.key} value={item.key}>{item.name} · {item.location} · {item.tee} tees · {formatLabel(item.segment, item.holes)} ({item.points.length})</option>)}
      </select>
      <dl className="format-stats">
        <div><dt>Rounds</dt><dd>{points.length}</dd></div>
        <div><dt>Average</dt><dd>{group.average.toFixed(1)}</dd><small>All rounds here</small></div>
        <div><dt>Best</dt><dd>{group.best}</dd><small>Strokes</small></div>
        <div><dt>Latest</dt><dd>{last.total}</dd><small>{formatToPar(last.toPar)} to par</small></div>
      </dl>
      <p>{points.length === 1 ? "Your first score here. Play again to start seeing change." : change === 0 ? "Same score as your first round here." : `${Math.abs(change)} ${Math.abs(change) === 1 ? "stroke" : "strokes"} ${change < 0 ? "lower" : "higher"} than your first round here.`}</p>
      <div className="course-history-scroll" tabIndex={0} role="region" aria-label="Course score history, oldest to newest">
        <div style={{ minWidth: Math.max(280, points.length * 85) }}>
          <div className="score-trend-plot" aria-hidden="true">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline className="score-trend-line" points={points.map((point, index) => `${x(index)},${y(point.total)}`).join(" ")} /></svg>
            {points.map((point, index) => <i key={point.id} className="score-trend-dot" style={{ left: `${x(index)}%`, top: `${y(point.total)}%` }} />)}
          </div>
          <ol className="course-history-dates">
            {points.map((point, index) => <li key={point.id} style={{ left: `${x(index)}%` }}><Link href={`/rounds/${point.id}`} aria-label={`Open ${group.name}, ${new Date(point.date).toLocaleDateString()}, ${point.total} strokes, ${formatToPar(point.toPar)} to par`}><strong>{point.total}</strong><small>{formatToPar(point.toPar)}</small><time dateTime={point.date}>{new Date(point.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}</time></Link></li>)}
          </ol>
        </div>
      </div>
      <p className="trend-footnote">Oldest to newest, one point per round. Lower scores sit lower. Tap a score to open the round.</p>
      <p className="score-trend-statement">{describeTrend(group.trend)} Same course, tees and holes; latest {group.trend.points.length} rounds.</p>
    </section>
  );
}
