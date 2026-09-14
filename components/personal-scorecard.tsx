import { formatToPar } from "@/lib/metrics";
import type { NineLine, PersonalScorecard as ScorecardData } from "@/lib/personal-par";
import { SCORE_TYPE_NAMES } from "@/lib/round-report";

/**
 * A finished round laid out like the paper card golfers already read: par, your par, the
 * shots taken, and how each hole went against your par.
 */

function tone(value: number | null): string | undefined {
  if (value === null) return undefined;
  if (value < 0) return "under";
  if (value > 0) return "over";
  return "even";
}

const signed = (value: number | null) => (value === null ? "—" : formatToPar(value));

export function PersonalScorecard({ card }: { card: ScorecardData }) {
  const { handicapIndex, roundHandicap } = card;
  const personal = handicapIndex !== null && roundHandicap !== null;

  let note: string;
  if (handicapIndex === null || roundHandicap === null) {
    note = "Your par shows once a completed round before this one has set your handicap.";
  } else if (roundHandicap === 0) {
    note = `Your ${handicapIndex.toFixed(1)} handicap going into this round gave no strokes here, so your par is the course par.`;
  } else {
    note = `Your par adds the ${roundHandicap} ${roundHandicap === 1 ? "stroke" : "strokes"} your ${handicapIndex.toFixed(1)} handicap gave you going into this round, hardest holes first.`;
  }

  return (
    <section className="personal-card surface-card" aria-label="Scorecard">
      <div className="personal-card-head">
        <h2>Scorecard</h2>
        <p>{note}</p>
      </div>
      {card.nines.map((nine) => (
        <NineTable key={nine.label} nine={nine} personal={personal} />
      ))}
      {personal && roundHandicap ? (
        <p className="card-legend"><span className="card-legend-swatch" aria-hidden="true" /> A stroke from your handicap</p>
      ) : null}
    </section>
  );
}

function NineTable({ nine, personal }: { nine: NineLine; personal: boolean }) {
  return (
    <div className="card-table-scroll">
      <table className="card-table">
        <thead>
          <tr>
            <th scope="row">Hole</th>
            {nine.holes.map((line) => <th key={line.hole.number} scope="col">{line.hole.number}</th>)}
            <th scope="col" className="card-total">{nine.label}</th>
          </tr>
        </thead>
        <tbody>
          <tr className="card-row-par">
            <th scope="row">Par</th>
            {nine.holes.map((line) => <td key={line.hole.number}>{line.par}</td>)}
            <td className="card-total">{nine.par}</td>
          </tr>
          {personal ? (
            <tr className="card-row-yours">
              <th scope="row">Your par</th>
              {nine.holes.map((line) => (
                <td
                  key={line.hole.number}
                  className={line.strokesReceived ? "gets-stroke" : undefined}
                  title={line.strokesReceived ? `+${line.strokesReceived} from your handicap` : undefined}
                >
                  {line.yourPar}
                </td>
              ))}
              <td className="card-total">{nine.yourPar ?? "—"}</td>
            </tr>
          ) : null}
          <tr className="card-row-shots">
            <th scope="row">Shots</th>
            {nine.holes.map((line) => (
              <td
                key={line.hole.number}
                aria-label={line.score === null || !line.type ? "No score" : `${line.score}, ${SCORE_TYPE_NAMES[line.type].single}`}
              >
                {line.score === null || !line.type ? "—" : <span className={`score-mark ${line.type}`}>{line.score}</span>}
              </td>
            ))}
            <td className="card-total">{nine.score ?? "—"}</td>
          </tr>
          {personal ? (
            <tr className="card-row-vs">
              <th scope="row">vs you</th>
              {nine.holes.map((line) => <td key={line.hole.number} className={tone(line.vsYourPar)}>{signed(line.vsYourPar)}</td>)}
              <td className={`card-total ${tone(nine.vsYourPar) ?? ""}`}>{signed(nine.vsYourPar)}</td>
            </tr>
          ) : (
            <tr className="card-row-vs">
              <th scope="row">vs par</th>
              {nine.holes.map((line) => <td key={line.hole.number} className={tone(line.vsPar)}>{signed(line.vsPar)}</td>)}
              <td className={`card-total ${tone(nine.vsPar) ?? ""}`}>{signed(nine.vsPar)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
