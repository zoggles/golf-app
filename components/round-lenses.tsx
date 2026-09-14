import { Flag, Scales, UserCircle } from "@phosphor-icons/react";
import { formatToPar } from "@/lib/metrics";
import { CONFIDENCE_LABELS } from "@/lib/personal-baseline";
import { describeVsTarget, type RoundScorecard } from "@/lib/round-scorecard";
import { toneOf, type PersonalHeadline } from "@/lib/round-story";

/**
 * The three ways to read a score, side by side and never blended.
 *
 * Par tells you how you compare to golf. Handicap tells you how you compare competitively.
 * Your baseline tells you whether you are getting better.
 */
export function RoundLenses({ card, headline }: { card: RoundScorecard; headline: PersonalHeadline }) {
  const handicapTone = toneOf(card.vsTarget);

  return (
    <section className="round-lenses" aria-label="How this round compares">
      <article className="lens">
        <header><Flag size={14} weight="fill" /><small>VS PAR</small></header>
        {/* Beginners are over par nearly every round, so this one is never coloured as a verdict. */}
        <strong>{card.vsPar === null ? "—" : formatToPar(card.vsPar)}</strong>
        <p>{card.score === null ? "No holes scored yet" : `${card.score} on a par ${card.par}`}</p>
        <span className="lens-why">How you compare to golf</span>
      </article>

      <article className="lens">
        <header><Scales size={14} weight="fill" /><small>VS HANDICAP</small></header>
        {card.vsTarget === null || card.target === null ? (
          <>
            <strong className="lens-pending">—</strong>
            <p>Your handicap target appears once a finished round before this one sets your handicap.</p>
          </>
        ) : (
          <>
            <strong className={handicapTone ?? undefined}>{formatToPar(card.vsTarget)}</strong>
            <p>{describeVsTarget(card.vsTarget)}</p>
            <small>Target {card.target} · Round HCP {card.roundHandicap}</small>
          </>
        )}
        <span className="lens-why">How you compare competitively</span>
      </article>

      <article className="lens lens-you">
        <header>
          <UserCircle size={14} weight="fill" />
          <small>VS YOU</small>
          <em className={`confidence-pill ${headline.confidence}`}>{CONFIDENCE_LABELS[headline.confidence]}</em>
        </header>
        <strong className={headline.value === null ? "lens-pending" : headline.tone ?? undefined}>{headline.value ?? "—"}</strong>
        <p>{headline.title}</p>
        <small>{headline.detail}</small>
        <span className="lens-why">Whether you’re getting better</span>
      </article>
    </section>
  );
}
