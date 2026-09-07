"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  CaretLeft,
  CaretRight,
  Check,
  FlagPennant,
  MapPin,
  Minus,
  Plus,
  Sparkle,
  Trash,
} from "@phosphor-icons/react";
import { GENESEE_VALLEY_SOUTH, getSegmentHoles, segmentLabel } from "@/lib/courses";
import { completeRound, discardActiveRound, firstUnscoredHole, saveCourse, startRound, updateRoundScore } from "@/lib/storage";
import { formatToPar, summarizeRound } from "@/lib/metrics";
import { parseScoreCommands, parseStartCommand } from "@/lib/voice-parser";
import type { Course, RoundSegment } from "@/lib/types";
import { useGolfData } from "@/hooks/use-golf-data";
import { VoiceControl } from "./voice-control";

export function PlayPage() {
  const data = useGolfData();
  const activeRound = data.rounds.find((round) => round.id === data.activeRoundId);
  return <div className="page-shell">{activeRound ? <ActiveRound roundId={activeRound.id} /> : <RoundStarter />}</div>;
}

function RoundStarter() {
  const data = useGolfData();
  const [showSetup, setShowSetup] = useState(false);
  const [segment, setSegment] = useState<RoundSegment>("front9");
  const [phrase, setPhrase] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<Course>(GENESEE_VALLEY_SOUTH);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [courseConfirmed, setCourseConfirmed] = useState(true);

  async function handleVoice(text: string) {
    const command = parseStartCommand(text);
    setPhrase(text);
    setSegment(command.segment);
    setLookupError(null);
    const savedCourse = data.courses.find((course) => text.toLowerCase().includes(course.shortName.toLowerCase()));
    if (command.courseId === GENESEE_VALLEY_SOUTH.id || savedCourse) {
      const course = savedCourse ?? GENESEE_VALLEY_SOUTH;
      setSelectedCourse(course);
      setMessage(`Found ${course.shortName}. ${segmentLabel(command.segment)} is ready.`);
      setCourseConfirmed(true);
      return;
    }
    setCourseConfirmed(false);
    setIsLookingUp(true);
    setMessage("Searching current course and scorecard sources…");
    try {
      const response = await fetch("/api/courses/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text }),
      });
      const result = (await response.json()) as { course?: Course; error?: string };
      if (!response.ok || !result.course) throw new Error(result.error || "Course lookup failed.");
      saveCourse(result.course);
      setSelectedCourse(result.course);
      setCourseConfirmed(true);
      if (result.course.holes.length === 9) setSegment("front9");
      setMessage(`Verified ${result.course.shortName} from its published scorecard.`);
    } catch (cause) {
      setMessage(null);
      setLookupError(cause instanceof Error ? cause.message : "I couldn’t verify that course.");
    } finally {
      setIsLookingUp(false);
    }
  }

  function beginRound() {
    startRound(selectedCourse, segment, phrase || undefined);
  }

  const visibleHoles = getSegmentHoles(selectedCourse, segment);
  const segmentPar = visibleHoles.reduce((total, hole) => total + hole.par, 0);
  const segmentYards = visibleHoles.reduce((total, hole) => total + hole.yards, 0);

  return (
    <>
      <section className="hero-block">
        <p className="eyebrow"><span /> YOUR NEXT ROUND</p>
        <h1>Play the shot.<br /><em>Remember the round.</em></h1>
        <p className="hero-lede">A scorecard that listens, keeps pace, and turns every round into a clearer picture of your game.</p>
        {!showSetup ? (
          <button className="primary-button hero-action" type="button" onClick={() => setShowSetup(true)}>
            Start a round <ArrowRight size={19} weight="bold" />
          </button>
        ) : null}
      </section>

      {showSetup ? (
        <section className="setup-card surface-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">ROUND SETUP</p>
              <h2>Where are we playing?</h2>
            </div>
            <span className="step-pill">1 of 1</span>
          </div>
          <VoiceControl
            onSubmit={handleVoice}
            placeholder="Describe your round"
            example='Try “Front 9 at Genesee Valley South”'
          />
          {message ? <div className="success-note"><Check size={17} weight="bold" />{message}</div> : null}
          {lookupError ? <div className="voice-error">{lookupError}</div> : null}
          <div className="field-group">
            <label>Course</label>
            <div className="course-choice selected">
              <span className="course-icon"><FlagPennant size={21} weight="fill" /></span>
              <span><strong>{selectedCourse.shortName}</strong><small><MapPin size={13} /> {selectedCourse.location}</small></span>
              <Check className="choice-check" size={19} weight="bold" />
            </div>
          </div>
          <div className="field-group">
            <label>Round</label>
            <div className="segment-control">
              {(["front9", "back9", "full18"] as RoundSegment[]).filter((option) => selectedCourse.holes.length === 18 || option === "front9").map((option) => (
                <button key={option} type="button" onClick={() => setSegment(option)} className={segment === option ? "selected" : ""}>
                  {segmentLabel(option)}
                </button>
              ))}
            </div>
          </div>
          <div className="course-facts">
            <span><small>TEE</small>{selectedCourse.tee}</span>
            <span><small>PAR</small>{segmentPar}</span>
            <span><small>YARDS</small>{segmentYards.toLocaleString()}</span>
          </div>
          <button className="primary-button full-width" type="button" onClick={beginRound} disabled={isLookingUp || !courseConfirmed}>
            Begin {segmentLabel(segment)} <ArrowRight size={19} weight="bold" />
          </button>
        </section>
      ) : (
        <section className="preview-card">
          <div className="preview-orbit"><span>18</span><small>HOLES</small></div>
          <div><p>Voice-ready scoring</p><span>Say the hole and score. We’ll handle the card.</span></div>
        </section>
      )}

      <section className="feature-row">
        <div><Sparkle size={20} weight="fill" /><span><strong>Simple by design</strong><small>Built for one-handed use between holes.</small></span></div>
        <div><FlagPennant size={20} weight="fill" /><span><strong>Your history starts here</strong><small>Every finish feeds your Progress dashboard.</small></span></div>
      </section>
    </>
  );
}

function ActiveRound({ roundId }: { roundId: string }) {
  const data = useGolfData();
  const round = data.rounds.find((item) => item.id === roundId);
  const course = round?.course ?? GENESEE_VALLEY_SOUTH;
  const holes = useMemo(() => (round ? getSegmentHoles(course, round.segment) : []), [course, round]);
  const initialHole = round ? firstUnscoredHole(round) ?? holes[0]?.number ?? 1 : 1;
  const [selectedHole, setSelectedHole] = useState(initialHole);
  const [manualScore, setManualScore] = useState(
    () => round?.scores[initialHole] ?? course.holes.find((item) => item.number === initialHole)?.par ?? 4,
  );
  const [feedback, setFeedback] = useState("Ready for your first score.");

  const currentHole = course.holes.find((item) => item.number === selectedHole) ?? course.holes[0];

  if (!round) return null;
  const summary = summarizeRound(round);
  const completedHoles = Object.keys(round.scores).length;
  const allHolesScored = completedHoles === holes.length;

  function applyScore(holeNumber: number, strokes: number, source: "voice" | "manual", rawText?: string) {
    const validHole = holes.some((holeItem) => holeItem.number === holeNumber);
    if (!validHole) {
      setFeedback(`Hole ${holeNumber} isn’t part of this ${segmentLabel(round!.segment)}.`);
      return;
    }
    updateRoundScore(round!.id, holeNumber, strokes, source, rawText);
    setFeedback(`Hole ${holeNumber} saved at ${strokes} ${strokes === 1 ? "stroke" : "strokes"}.`);
    const index = holes.findIndex((holeItem) => holeItem.number === holeNumber);
    const nextHole = holes.slice(index + 1).find((holeItem) => round!.scores[holeItem.number] == null);
    if (nextHole) selectHole(nextHole.number);
  }

  async function handleVoice(text: string) {
    setFeedback("Understanding your update…");
    try {
      const response = await fetch("/api/round-command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          currentHole: selectedHole,
          holes: holes.map((hole) => ({ number: hole.number, par: hole.par })),
          scores: round!.scores,
        }),
      });
      const result = (await response.json()) as { updates?: Array<{ hole: number; strokes: number }>; reply?: string; error?: string };
      if (!response.ok) throw new Error(result.error || "I couldn’t understand that update.");
      const updates = (result.updates ?? []).filter((update) => holes.some((hole) => hole.number === update.hole));
      if (!updates.length) {
        setFeedback(result.reply || "Which hole and score should I update?");
        return;
      }
      for (const update of updates) updateRoundScore(round!.id, update.hole, update.strokes, "voice", text);
      const last = updates[updates.length - 1];
      selectHole(last.hole);
      setFeedback(result.reply || `Updated ${updates.length} ${updates.length === 1 ? "hole" : "holes"}.`);
    } catch (cause) {
      const fallback = parseScoreCommands(text, course, selectedHole).filter((update) => holes.some((hole) => hole.number === update.hole));
      if (fallback.length) {
        for (const update of fallback) updateRoundScore(round!.id, update.hole, update.strokes, "voice", text);
        selectHole(fallback[fallback.length - 1].hole);
        setFeedback(`Updated ${fallback.map((update) => `hole ${update.hole} to ${update.strokes}`).join(" and ")}.`);
      } else setFeedback(cause instanceof Error ? cause.message : "I couldn’t understand that update.");
    }
  }

  function moveHole(direction: -1 | 1) {
    const currentIndex = holes.findIndex((holeItem) => holeItem.number === selectedHole);
    const nextIndex = Math.min(holes.length - 1, Math.max(0, currentIndex + direction));
    selectHole(holes[nextIndex].number);
  }

  function selectHole(holeNumber: number) {
    const selected = course.holes.find((item) => item.number === holeNumber);
    setSelectedHole(holeNumber);
    setManualScore(round!.scores[holeNumber] ?? selected?.par ?? 4);
  }

  return (
    <>
      <section className="round-header">
        <div>
          <p className="eyebrow"><span className="live-dot" /> ROUND IN PROGRESS</p>
          <h1>{course.shortName}</h1>
          <p><MapPin size={14} /> {course.location} · {segmentLabel(round.segment)} · {round.tee} tees</p>
        </div>
        <div className="round-total"><small>THRU</small><strong>{completedHoles}</strong><span>{formatToPar(summary.toPar)}</span></div>
      </section>

      <section className="hole-focus surface-card">
        <div className="hole-nav">
          <button type="button" onClick={() => moveHole(-1)} disabled={selectedHole === holes[0].number} aria-label="Previous hole"><CaretLeft size={21} /></button>
          <span>HOLE <strong>{currentHole.number}</strong> OF {holes[holes.length - 1].number}</span>
          <button type="button" onClick={() => moveHole(1)} disabled={selectedHole === holes[holes.length - 1].number} aria-label="Next hole"><CaretRight size={21} /></button>
        </div>
        <div className="hole-stats">
          <div><small>PAR</small><strong>{currentHole.par}</strong></div>
          <div><small>WHITE</small><strong>{currentHole.yards}</strong><span>YDS</span></div>
          <div><small>HDCP</small><strong>{currentHole.handicap}</strong></div>
        </div>
        <div className="club-callout">
          <div><small>SUGGESTED OFF THE TEE</small><strong>{currentHole.suggestedClub}</strong></div>
          <p>{currentHole.strategy}</p>
        </div>
        <div className="score-stepper">
          <button type="button" onClick={() => setManualScore((score) => Math.max(1, score - 1))} aria-label="Decrease score"><Minus size={23} weight="bold" /></button>
          <div><span>SCORE</span><strong>{manualScore}</strong><small>{formatScoreName(manualScore - currentHole.par)}</small></div>
          <button type="button" onClick={() => setManualScore((score) => Math.min(20, score + 1))} aria-label="Increase score"><Plus size={23} weight="bold" /></button>
        </div>
        <button className="primary-button full-width" type="button" onClick={() => applyScore(currentHole.number, manualScore, "manual")}>
          Save hole {currentHole.number} <Check size={19} weight="bold" />
        </button>
      </section>

      <section className="voice-score-card surface-card">
        <div className="section-heading tight"><div><p className="eyebrow">HANDS-FREE UPDATE</p><h2>Tell me your score</h2></div></div>
        <VoiceControl onSubmit={handleVoice} placeholder="e.g. Change hole 3 to 5 strokes" example='Try “Change hole 3 to 5, and hole 4 was a bogey”' compact />
        <div className="feedback-line"><Sparkle size={15} weight="fill" /> {feedback}</div>
      </section>

      <section className="scorecard-section">
        <div className="section-heading"><div><p className="eyebrow">SCORECARD</p><h2>{segmentLabel(round.segment)}</h2></div><strong>{summary.total || "—"}</strong></div>
        <div className="score-grid">
          {holes.map((holeItem) => {
            const score = round.scores[holeItem.number];
            return (
              <button key={holeItem.number} type="button" onClick={() => selectHole(holeItem.number)} className={selectedHole === holeItem.number ? "hole-cell selected" : "hole-cell"}>
                <span>{holeItem.number}</span>
                <strong>{score ?? "—"}</strong>
                <small>PAR {holeItem.par}</small>
              </button>
            );
          })}
        </div>
      </section>

      <section className="round-actions">
        <button className="secondary-button" type="button" onClick={() => discardActiveRound(round.id)}><Trash size={18} /> Discard</button>
        <button className="primary-button" type="button" onClick={() => completeRound(round.id)} disabled={!allHolesScored}>
          Complete round <FlagPennant size={18} weight="fill" />
        </button>
      </section>
      {!allHolesScored ? <p className="completion-note">Score {holes.length - completedHoles} more {holes.length - completedHoles === 1 ? "hole" : "holes"} to complete this round.</p> : null}
    </>
  );
}

function formatScoreName(toPar: number): string {
  if (toPar <= -2) return "Eagle or better";
  if (toPar === -1) return "Birdie";
  if (toPar === 0) return "Par";
  if (toPar === 1) return "Bogey";
  if (toPar === 2) return "Double bogey";
  return `+${toPar}`;
}
