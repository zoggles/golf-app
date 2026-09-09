"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import type { Photo } from "@capacitor/camera";
import { ArrowClockwise, Camera, CircleNotch, Info, MapPin, UploadSimple, Warning } from "@phosphor-icons/react";
import { useGolfData } from "@/hooks/use-golf-data";
import { getSegmentHoles, segmentLabel } from "@/lib/courses";
import { formatToPar } from "@/lib/metrics";
import {
  buildImportedRound,
  scorecardReadingSchema,
  type ImportedRound,
  type ScorecardReading,
} from "@/lib/scorecard-import";
import { importCompletedRound } from "@/lib/storage";
import { apiUrl } from "@/lib/api-url";

/**
 * Logs a round from a photograph of a paper scorecard: shoot the card, check
 * what came back, save it. The check is one glance and one tap, because a
 * misread digit is much cheaper to fix here than in the round history.
 */
export function ScorecardPhotoImport() {
  const router = useRouter();
  const data = useGolfData();
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [isReading, setIsReading] = useState(false);
  const [reading, setReading] = useState<ScorecardReading | null>(null);
  const [playerIndex, setPlayerIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const imported = useMemo<{ round: ImportedRound | null; error: string | null }>(() => {
    if (!reading) return { round: null, error: null };
    try {
      return { round: buildImportedRound(reading, { playerIndex, knownCourses: data.courses }), error: null };
    } catch (cause) {
      return { round: null, error: cause instanceof Error ? cause.message : "I couldn’t use that scorecard." };
    }
  }, [reading, playerIndex, data.courses]);

  async function readPhoto(file: File | undefined) {
    if (!file) return;
    setError(null);
    setReading(null);
    setPlayerIndex(0);
    setIsReading(true);
    try {
      const body = new FormData();
      body.append("photo", file);
      const response = await fetch(apiUrl("/api/scorecard-photo"), { method: "POST", body });
      const result = (await response.json()) as { reading?: unknown; error?: string };
      if (!response.ok) throw new Error(result.error || "I couldn’t read that scorecard.");
      setReading(scorecardReadingSchema.parse(result.reading));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "I couldn’t read that scorecard.");
    } finally {
      setIsReading(false);
    }
  }

  function photoToFile(photo: Photo): File {
    if (!photo.base64String) throw new Error("The selected photo could not be opened.");
    const decoded = window.atob(photo.base64String);
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
    const extension = photo.format || "jpeg";
    return new File([bytes], `scorecard.${extension}`, { type: `image/${extension}` });
  }

  async function chooseNativePhoto(source: "camera" | "photos") {
    try {
      const { Camera: NativeCamera, CameraResultType, CameraSource } = await import("@capacitor/camera");
      const photo = await NativeCamera.getPhoto({
        source: source === "camera" ? CameraSource.Camera : CameraSource.Photos,
        resultType: CameraResultType.Base64,
        quality: 90,
        correctOrientation: true,
      });
      await readPhoto(photoToFile(photo));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      if (/cancel/i.test(message)) return;
      setError(message || "The photo picker could not be opened.");
    }
  }

  function openPhotoSource(source: "camera" | "photos") {
    if (Capacitor.isNativePlatform()) {
      void chooseNativePhoto(source);
      return;
    }
    (source === "camera" ? cameraInput : fileInput).current?.click();
  }

  function saveRound() {
    const round = imported.round;
    if (!round) return;
    const saved = importCompletedRound({
      course: round.course,
      segment: round.segment,
      scores: round.scores,
      playedAt: round.playedAt,
      note: "Logged from a scorecard photo",
    });
    router.push(`/rounds/${saved.id}`);
  }

  function reset() {
    setReading(null);
    setError(null);
    setPlayerIndex(0);
  }

  return (
    <section className="scan-card surface-card">
      <div className="section-heading tight">
        <div>
          <p className="eyebrow">PAPER SCORECARD</p>
          <h2>Log a round from a photo</h2>
        </div>
      </div>

      {reading && imported.round ? (
        <ScorecardReview
          reading={reading}
          round={imported.round}
          playerIndex={playerIndex}
          onSelectPlayer={setPlayerIndex}
          onSave={saveRound}
          onRetake={reset}
        />
      ) : (
        <>
          <p className="scan-copy">
            Photograph the whole card, flat and well lit. I read the holes, pars, and every scored column, then show you
            what I found before anything is saved.
          </p>
          <div className="scan-actions">
            <button className="primary-button" type="button" onClick={() => openPhotoSource("camera")} disabled={isReading}>
              {isReading ? <span className="spin"><CircleNotch size={19} weight="bold" /></span> : <Camera size={19} weight="fill" />}
              {isReading ? "Reading the card…" : "Take a photo"}
            </button>
            <button className="secondary-button" type="button" onClick={() => openPhotoSource("photos")} disabled={isReading}>
              <UploadSimple size={18} /> Choose a photo
            </button>
          </div>
          {imported.error ? <p className="voice-error">{imported.error}</p> : null}
          {error ? <p className="voice-error">{error}</p> : null}
        </>
      )}

      <input
        ref={cameraInput}
        className="visually-hidden"
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="Take a photo of a paper scorecard"
        onChange={(event) => {
          void readPhoto(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <input
        ref={fileInput}
        className="visually-hidden"
        type="file"
        accept="image/*"
        aria-label="Choose a photo of a paper scorecard"
        onChange={(event) => {
          void readPhoto(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </section>
  );
}

function ScorecardReview({
  reading,
  round,
  playerIndex,
  onSelectPlayer,
  onSave,
  onRetake,
}: {
  reading: ScorecardReading;
  round: ImportedRound;
  playerIndex: number;
  onSelectPlayer: (index: number) => void;
  onSave: () => void;
  onRetake: () => void;
}) {
  const holes = getSegmentHoles(round.course, round.segment);
  const scored = holes.filter((hole) => round.scores[hole.number] != null);
  const total = scored.reduce((sum, hole) => sum + round.scores[hole.number], 0);
  const par = scored.reduce((sum, hole) => sum + hole.par, 0);

  return (
    <>
      <div className="scan-summary">
        <div>
          <strong>{round.course.shortName}</strong>
          <small>
            <MapPin size={13} /> {round.course.location || "Location not printed"} · {segmentLabel(round.segment)} ·{" "}
            {round.course.tee} tees
          </small>
          <time dateTime={round.playedAt}>
            {new Date(round.playedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            {reading.datePlayed ? "" : " · date not printed, using today"}
          </time>
        </div>
        <div className="scan-total">
          <small>TOTAL</small>
          <strong>{total}</strong>
          <span>{formatToPar(total - par)}</span>
        </div>
      </div>

      {reading.players.length > 1 ? (
        <div className="field-group">
          <label>Which column is yours?</label>
          <div className="segment-control scan-players">
            {reading.players.map((player, index) => (
              <button
                key={`${player.name}-${index}`}
                type="button"
                onClick={() => onSelectPlayer(index)}
                className={index === playerIndex ? "selected" : ""}
              >
                {player.name.trim() || `Column ${index + 1}`}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="score-grid scan-grid">
        {holes.map((hole) => (
          <div key={hole.number} className="hole-cell">
            <span>{hole.number}</span>
            <strong>{round.scores[hole.number] ?? "—"}</strong>
            <small>PAR {hole.par}</small>
          </div>
        ))}
      </div>

      {round.missingHoles.length ? (
        <p className="scan-warning">
          <Warning size={15} weight="fill" /> {round.missingHoles.length === 1 ? "Hole" : "Holes"}{" "}
          {round.missingHoles.join(", ")} came back blank. Save the round and fill them in on the scorecard that opens
          next.
        </p>
      ) : null}
      {reading.note.trim() ? (
        <p className="scan-note">
          <Info size={15} /> {reading.note.trim()}
        </p>
      ) : null}
      {round.matchedKnownCourse ? null : (
        <p className="scan-note">
          <Info size={15} /> Saving this card as a new course built from its printed pars and yardages.
        </p>
      )}

      <div className="scan-actions">
        <button className="primary-button" type="button" onClick={onSave}>
          Log this round
        </button>
        <button className="secondary-button" type="button" onClick={onRetake}>
          <ArrowClockwise size={18} /> Use a different photo
        </button>
      </div>
    </>
  );
}
