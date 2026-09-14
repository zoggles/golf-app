import { formatToPar } from "@/lib/metrics";
import { describeTrend, type ScoringTrend } from "@/lib/personal-baseline";

/**
 * Your last few rounds of one length as a line, with the sentence that reads it.
 *
 * Heights follow strokes over par, so rounds at different courses line up fairly, and each
 * point is labelled with what you actually shot. Worse sits higher, so a line heading down is a
 * golfer getting better. Positions are percentages of the plot: the line stretches to any
 * width while its dots and labels stay round and readable.
 */
export function ScoreTrend({ trend }: { trend: ScoringTrend }) {
  const { points } = trend;
  const tone = trend.direction === "improving" ? "under" : trend.direction === "worsening" ? "over" : "even";
  if (points.length < 2) return <p className={`score-trend-statement ${tone}`}>{describeTrend(trend)}</p>;

  const values = points.map((point) => point.toPar);
  const high = Math.max(...values);
  const low = Math.min(...values);
  const left = (index: number) => 5 + (index * 90) / (points.length - 1);
  const top = (value: number) => (high === low ? 50 : 12 + ((high - value) / (high - low)) * 76);
  const line = points.map((point, index) => `${left(index)},${top(point.toPar)}`).join(" ");
  const day = (date: string) => new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <div className="score-trend">
      <div className="score-trend-plot" role="img" aria-label={`Scores, oldest first: ${points.map((point) => point.total).join(", ")}`}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <polyline className="score-trend-line" points={line} />
        </svg>
        {points.map((point, index) => (
          <i
            key={point.roundId}
            className={point.current ? "score-trend-dot current" : "score-trend-dot"}
            style={{ left: `${left(index)}%`, top: `${top(point.toPar)}%` }}
          />
        ))}
      </div>
      <ol className="score-trend-points" aria-hidden="true">
        {points.map((point, index) => (
          <li
            key={point.roundId}
            className={point.current ? "current" : undefined}
            style={{ left: `${left(index)}%` }}
            title={`${point.courseName}, ${day(point.playedAt)}`}
          >
            <strong>{point.total}</strong>
            <small>{formatToPar(point.toPar)}</small>
          </li>
        ))}
      </ol>
      <p className={`score-trend-statement ${tone}`}>{describeTrend(trend)}</p>
    </div>
  );
}
