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
import { estimateHandicap, estimateRoundHandicap, formatToPar, handicapStrokesForHole, summarizeRound } from "@/lib/metrics";
import { nextHoleAfterVoiceUpdates, parseScoreCommands, parseStartCommand, type ScoreCommand } from "@/lib/voice-parser";
import { COMMON_TEES, courseMatchesPhrase, extractTeeMention, normalizeTee, samePhysicalCourse, teeOptionLabel } from "@/lib/tee-selection";
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
  const [segment, setSegment] = useState<RoundSegment>("front9");
  const [phrase, setPhrase] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [activity, setActivity] = useState<string | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<Course>(GENESEE_VALLEY_SOUTH);
  const [teeChoice, setTeeChoice] = useState(GENESEE_VALLEY_SOUTH.tee);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [courseConfirmed, setCourseConfirmed] = useState(true);

  const availableCourses = useMemo(() => {
    const byId = new Map<string, Course>([[GENESEE_VALLEY_SOUTH.id, GENESEE_VALLEY_SOUTH]]);
    for (const course of data.courses) byId.set(course.id, course);
    for (const round of data.rounds) {
      if (!byId.has(round.courseId)) byId.set(round.courseId, round.course);
    }
    return [...byId.values()];
  }, [data.courses, data.rounds]);

  const teeOptions = useMemo(() => {
    const values = new Map<string, string>();
    for (const tee of [teeChoice, ...availableCourses.filter((course) => samePhysicalCourse(course, selectedCourse)).map((course) => course.tee), ...COMMON_TEES]) {
      values.set(normalizeTee(tee), tee);
    }
    return [...values.values()];
  }, [availableCourses, selectedCourse, teeChoice]);

  async function researchCourse(query: string, status: string): Promise<Course | null> {
    const previousTee = selectedCourse.tee;
    setCourseConfirmed(false);
    setIsLookingUp(true);
    setLookupError(null);
    setMessage(null);
    setActivity(status);
    try {
      const response = await fetch("/api/courses/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const result = (await response.json()) as { course?: Course; error?: string };
      if (!response.ok || !result.course) throw new Error(result.error || "Course lookup failed.");
      saveCourse(result.course);
      setSelectedCourse(result.course);
      setTeeChoice(result.course.tee);
      setCourseConfirmed(true);
      if (result.course.holes.length === 9) setSegment("front9");
      return result.course;
    } catch (cause) {
      setTeeChoice(previousTee);
      setCourseConfirmed(true);
      setLookupError(cause instanceof Error ? cause.message : "I couldn’t verify that course and tee.");
      return null;
    } finally {
      setIsLookingUp(false);
      setActivity(null);
    }
  }

  async function chooseTee(course: Course, tee: string) {
    setTeeChoice(tee);
    setLookupError(null);
    setMessage(null);
    const savedTee = availableCourses.find((candidate) =>
      samePhysicalCourse(candidate, course) && normalizeTee(candidate.tee) === normalizeTee(tee),
    );
    if (savedTee) {
      setSelectedCourse(savedTee);
      setTeeChoice(savedTee.tee);
      setCourseConfirmed(true);
      if (savedTee.holes.length === 9) setSegment("front9");
      setMessage(`${savedTee.tee} tee scorecard loaded.`);
      return;
    }

    const result = await researchCourse(
      `${course.name}, ${course.location}. Use the ${tee} tee and return that tee's complete scorecard.`,
      `Finding the ${tee} tee scorecard and recalculating yardages and advice…`,
    );
    if (result) setMessage(`Verified the ${result.tee} tee scorecard and updated hole advice.`);
  }

  async function handleVoice(text: string) {
    const command = parseStartCommand(text);
    setPhrase(text);
    setSegment(command.segment);
    setLookupError(null);
    setMessage(null);
    setActivity("Checking your saved courses…");
    const requestedTee = extractTeeMention(text);
    const savedCourse = availableCourses.find((course) => courseMatchesPhrase(course, text));
    if (command.courseId === GENESEE_VALLEY_SOUTH.id || savedCourse) {
      const course = savedCourse ?? GENESEE_VALLEY_SOUTH;
      if (requestedTee && normalizeTee(requestedTee) !== normalizeTee(course.tee)) {
        await chooseTee(course, requestedTee);
        return;
      }
      setSelectedCourse(course);
      setTeeChoice(course.tee);
      setMessage(`Found ${course.shortName}. ${segmentLabel(command.segment)} is ready.`);
      setCourseConfirmed(true);
      setActivity(null);
      return;
    }
    const result = await researchCourse(text, "Searching published scorecards and verifying hole data…");
    if (result) setMessage(`Verified ${result.shortName} from its published ${result.tee} tee scorecard.`);
  }

  function chooseCourse(courseId: string) {
    const course = availableCourses.find((item) => item.id === courseId);
    if (!course) return;
    setSelectedCourse(course);
    setTeeChoice(course.tee);
    setCourseConfirmed(true);
    setLookupError(null);
    setMessage(`${course.shortName} selected.`);
    if (course.holes.length === 9) setSegment("front9");
  }

  function beginRound() {
    startRound(selectedCourse, segment, phrase || undefined);
  }

  const visibleHoles = getSegmentHoles(selectedCourse, segment);
  const segmentPar = visibleHoles.reduce((total, hole) => total + hole.par, 0);
  const segmentYards = visibleHoles.reduce((total, hole) => total + hole.yards, 0);

  return (
    <>
      <section className="page-title">
        <h1>New round</h1>
        <p>Search by course and location, or use the mic.</p>
      </section>

      <section className="setup-card surface-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">COURSE</p>
            <h2>Course and round</h2>
          </div>
        </div>
        <VoiceControl
          onSubmit={handleVoice}
          placeholder="Course, city, and round length"
          example='Try “Front 9 at Genesee Valley South”'
          activity={activity}
        />
        {message ? <div className="success-note"><Check size={17} weight="bold" />{message}</div> : null}
        {lookupError ? <div className="voice-error">{lookupError}</div> : null}
        <div className="field-group">
          <label htmlFor="saved-course">Saved courses</label>
          <select id="saved-course" className="course-select" value={selectedCourse.id} onChange={(event) => chooseCourse(event.target.value)} disabled={isLookingUp}>
            {availableCourses.map((course) => (
              <option key={course.id} value={course.id}>{course.shortName} — {course.tee} tees — {course.location}</option>
            ))}
          </select>
        </div>
        <div className="field-group course-summary">
          <label>Selected course</label>
          <div className="course-choice selected">
            <span className="course-icon"><FlagPennant size={21} weight="fill" /></span>
            <span><strong>{selectedCourse.shortName}</strong><small><MapPin size={13} /> {selectedCourse.location}</small></span>
            <Check className="choice-check" size={19} weight="bold" />
          </div>
        </div>
        <div className="field-group">
          <label htmlFor="tee-choice">Tee</label>
          <select
            id="tee-choice"
            className="course-select"
            value={teeChoice}
            onChange={(event) => void chooseTee(selectedCourse, event.target.value)}
            disabled={isLookingUp}
          >
            {teeOptions.map((tee) => <option key={tee} value={tee}>{teeOptionLabel(tee)}</option>)}
          </select>
          <small className="field-help">Quick guide only—course conventions vary. Changing tees refreshes every hole and club suggestion.</small>
        </div>
        <div className="field-group">
          <label>Holes</label>
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
          Start {segmentLabel(segment)} <ArrowRight size={19} weight="bold" />
        </button>
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
  const [activity, setActivity] = useState<string | null>(null);

  const currentHole = course.holes.find((item) => item.number === selectedHole) ?? course.holes[0];

  if (!round) return null;
  const summary = summarizeRound(round);
  const handicapIndex = estimateHandicap(data.rounds);
  const roundHandicap = estimateRoundHandicap(handicapIndex, course, round.segment);
  const currentHoleStrokes = handicapStrokesForHole(roundHandicap, currentHole, holes);
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

  function applyVoiceUpdates(updates: ScoreCommand[], text: string, reply?: string) {
    for (const update of updates) updateRoundScore(round!.id, update.hole, update.strokes, "voice", text);
    const nextHole = nextHoleAfterVoiceUpdates(
      holes.map((hole) => hole.number),
      round!.scores,
      selectedHole,
      updates,
    );
    if (nextHole !== selectedHole) selectHole(nextHole);
    setFeedback(reply || `Updated ${updates.map((update) => `hole ${update.hole} to ${update.strokes}`).join(" and ")}.`);
  }

  async function handleVoice(text: string) {
    const explicitUpdates = parseScoreCommands(text, course, selectedHole).filter((update) => holes.some((hole) => hole.number === update.hole));
    if (explicitUpdates.length) {
      applyVoiceUpdates(explicitUpdates, text);
      return;
    }

    setActivity("Interpreting the scorecard update…");
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
      applyVoiceUpdates(updates, text, result.reply);
    } catch (cause) {
      const fallback = parseScoreCommands(text, course, selectedHole).filter((update) => holes.some((hole) => hole.number === update.hole));
      if (fallback.length) {
        applyVoiceUpdates(fallback, text);
      } else setFeedback(cause instanceof Error ? cause.message : "I couldn’t understand that update.");
    } finally {
      setActivity(null);
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
          <p><MapPin size={14} /> {course.location} · {segmentLabel(round.segment)} · {round.tee} tees · Round HCP {roundHandicap ?? "—"}</p>
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
          <div><small>{round.tee.toUpperCase()}</small><strong>{currentHole.yards}</strong><span>YDS</span></div>
          <div><small>HOLE HCP</small><strong>{currentHole.handicap}</strong><span>{currentHoleStrokes ? `YOU GET +${currentHoleStrokes}` : "NO STROKE"}</span></div>
        </div>
        <p className="handicap-help">Hole HCP ranks difficulty: 1 is hardest, 18 is easiest. “You get +1” marks a handicap stroke for this round.</p>
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
        <VoiceControl onSubmit={handleVoice} placeholder="e.g. Change hole 3 to 5 strokes" example='Try “Change hole 3 to 5, and hole 4 was a bogey”' activity={activity} compact />
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
                <small>PAR {holeItem.par} · HCP {holeItem.handicap}</small>
                {handicapStrokesForHole(roundHandicap, holeItem, holes) ? <small className="hole-stroke">+{handicapStrokesForHole(roundHandicap, holeItem, holes)} stroke</small> : null}
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
