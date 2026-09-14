import { ScoreTrend } from "@/components/score-trend";
import { formatToPar } from "@/lib/metrics";
import {
  BASELINE_WINDOW,
  countWord,
  formatNoun,
  MIN_SAMPLES,
  type RoundBaseline,
  type RoundBaselines,
  type ScoringTrend,
} from "@/lib/personal-baseline";
import { EVEN_BAND, formatAverage, formatVsAverage, toneOf } from "@/lib/round-story";

/**
 * This round against your own: at this course, across rounds of the same length, where it
 * ranks, and which way your scores are heading. Comparisons still building say how many
 * rounds they need instead of showing a number.
 */
export function PersonalProgress({
  baselines,
  ranks,
  trend,
  courseName,
}: {
  baselines: RoundBaselines;
  ranks: string[];
  trend: ScoringTrend;
  courseName: string;
}) {
  const { result } = baselines;
  if (!result) return null;

  const rows: Array<{ baseline: RoundBaseline; label: string }> = [
    { baseline: baselines.course, label: `At ${courseName}` },
    { baseline: baselines.format, label: `Your ${formatNoun(result.holes, 2)}` },
  ];
  // Pace is the broad fallback, worth a row only while rounds of this length are still too few.
  if (baselines.format.average === null && baselines.pace.average !== null) {
    rows.push({ baseline: baselines.pace, label: "All your rounds, by pace" });
  }

  return (
    <section className="progress-card surface-card" aria-label="Compared with your own rounds">
      <div className="progress-card-head">
        <p className="eyebrow">YOUR BASELINE</p>
        <h2>You vs you</h2>
      </div>

      <ul className="baseline-rows">
        {rows.map(({ baseline, label }) => <BaselineRow key={baseline.kind} baseline={baseline} label={label} />)}
      </ul>

      {ranks.length ? (
        <ul className="rank-chips">
          {ranks.map((rank) => <li key={rank}>{rank}</li>)}
        </ul>
      ) : null}

      <div className="progress-trend">
        <h3>
          {trend.points.length > 1
            ? `Your last ${countWord(trend.points.length)} ${formatNoun(trend.holes, trend.points.length)}`
            : "Your trend"}
        </h3>
        <ScoreTrend trend={trend} />
      </div>

      <p className="progress-footnote">
        Averages use up to your last {BASELINE_WINDOW} rounds before this one, so they move as you improve. Nothing is averaged from fewer than {MIN_SAMPLES}.
      </p>
    </section>
  );
}

function BaselineRow({ baseline, label }: { baseline: RoundBaseline; label: string }) {
  const { average, delta, kind } = baseline;
  const best = baseline.best === null ? null : kind === "course" ? String(baseline.best) : formatToPar(baseline.best);
  const rounds = `${baseline.samples} ${baseline.samples === 1 ? "round" : "rounds"}`;

  if (average === null || delta === null) {
    return (
      <li className="baseline-row building">
        <div>
          <strong>{label}</strong>
          <small>
            {Math.min(baseline.rounds, MIN_SAMPLES)} of {MIN_SAMPLES} rounds to an average
            {best !== null ? ` · Best ${best}` : ""}
          </small>
        </div>
        <em className="confidence-pill building">Building</em>
      </li>
    );
  }

  const shownAverage = kind === "course" ? formatAverage(average) : `${formatVsAverage(average)} vs par`;
  // Pace scales nines and eighteens together, so it is shown in whole strokes.
  const whole = Math.round(Math.abs(delta));
  const shownDelta = kind === "pace" ? formatToPar(delta < 0 ? -whole : whole) : formatVsAverage(delta);

  return (
    <li className="baseline-row">
      <div>
        <strong>{label}</strong>
        <small>Avg {shownAverage} · {rounds}{best !== null ? ` · Best ${best}` : ""}</small>
      </div>
      <span className={`baseline-delta ${toneOf(delta, EVEN_BAND) ?? ""}`}>
        <strong>{shownDelta}</strong>
        <small>vs avg</small>
      </span>
    </li>
  );
}
