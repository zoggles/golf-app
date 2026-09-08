"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, Check, MapPin, Minus, Plus, Trash } from "@phosphor-icons/react";
import { useGolfData } from "@/hooks/use-golf-data";
import { getSegmentHoles, segmentLabel } from "@/lib/courses";
import { estimateHandicap, estimateRoundHandicap, formatToPar, handicapStrokesForHole } from "@/lib/metrics";
import { deleteRound, updateCompletedRoundScores } from "@/lib/storage";
import type { GolfRound } from "@/lib/types";

export function RoundDetailPage({ roundId }: { roundId: string }) {
  const data = useGolfData();
  const round = data.rounds.find((item) => item.id === roundId);

  if (!round) {
    return (
      <div className="page-shell round-detail-page">
        <Link className="back-link" href="/progress"><ArrowLeft size={17} /> Progress</Link>
        <section className="not-found-card surface-card"><h1>Round not found</h1><p>This round may have been deleted or saved in another browser.</p></section>
      </div>
    );
  }

  return <RoundEditor key={round.id} round={round} handicapIndex={estimateHandicap(data.rounds)} />;
}

function RoundEditor({ round, handicapIndex }: { round: GolfRound; handicapIndex: number | null }) {
  const router = useRouter();
  const course = round.course;
  const holes = useMemo(() => getSegmentHoles(course, round.segment), [course, round.segment]);
  const [scores, setScores] = useState<Record<number, number>>(() => ({ ...round.scores }));
  const [saved, setSaved] = useState(false);
  const isDirty = holes.some((hole) => scores[hole.number] !== round.scores[hole.number]);
  const total = holes.reduce((sum, hole) => sum + (scores[hole.number] ?? 0), 0);
  const par = holes.reduce((sum, hole) => sum + hole.par, 0);
  const roundHandicap = estimateRoundHandicap(handicapIndex, course, round.segment);

  function changeScore(holeNumber: number, change: number) {
    setSaved(false);
    setScores((current) => ({
      ...current,
      [holeNumber]: Math.min(20, Math.max(1, (current[holeNumber] ?? 1) + change)),
    }));
  }

  function saveChanges() {
    updateCompletedRoundScores(round.id, scores);
    setSaved(true);
  }

  function removeRound() {
    if (!window.confirm("Delete this round permanently?")) return;
    deleteRound(round.id);
    router.replace("/progress");
  }

  return (
    <div className="page-shell round-detail-page">
      <Link className="back-link" href="/progress"><ArrowLeft size={17} /> Progress</Link>

      <header className="round-detail-header">
        <div>
          <p className="eyebrow">COMPLETED ROUND</p>
          <h1>{course.shortName}</h1>
          <p><MapPin size={14} /> {course.location} · {segmentLabel(round.segment)} · {round.tee} tees · Round HCP {roundHandicap ?? "—"}</p>
          <time dateTime={round.completedAt ?? round.startedAt}>{new Date(round.completedAt ?? round.startedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</time>
        </div>
        <div className="round-detail-total"><small>TOTAL</small><strong>{total}</strong><span>{formatToPar(total - par)}</span></div>
      </header>

      <section className="round-editor surface-card">
        <p className="round-handicap-help">Hole HCP: 1 is hardest, 18 is easiest. “+1” is a stroke allocated from your Round HCP.</p>
        <div className="round-editor-heading"><span>HOLE</span><span>PAR</span><span>HOLE HCP</span><span>YARDS</span><span>SCORE</span></div>
        {holes.map((hole) => (
          <div className="round-editor-row" key={hole.number}>
            <strong>{hole.number}</strong>
            <span>{hole.par}</span>
            <span>{hole.handicap}{handicapStrokesForHole(roundHandicap, hole, holes) ? ` · +${handicapStrokesForHole(roundHandicap, hole, holes)}` : ""}</span>
            <span>{hole.yards}</span>
            <div className="inline-score-control">
              <button type="button" onClick={() => changeScore(hole.number, -1)} aria-label={`Decrease hole ${hole.number} score`}><Minus size={16} /></button>
              <strong>{scores[hole.number] ?? "—"}</strong>
              <button type="button" onClick={() => changeScore(hole.number, 1)} aria-label={`Increase hole ${hole.number} score`}><Plus size={16} /></button>
            </div>
          </div>
        ))}
      </section>

      <div className="round-edit-actions">
        <button className="danger-button" type="button" onClick={removeRound}><Trash size={18} /> Delete round</button>
        <div>
          {saved ? <span className="saved-indicator"><Check size={16} /> Saved</span> : null}
          <button className="primary-button" type="button" onClick={saveChanges} disabled={!isDirty}>Save changes</button>
        </div>
      </div>
    </div>
  );
}
