"use client";

import { useState } from "react";
import { CircleNotch, Microphone, PaperPlaneTilt, Waveform } from "@phosphor-icons/react";
import { useVoiceInput } from "@/hooks/use-voice-input";

interface VoiceControlProps {
  onSubmit: (text: string) => void | Promise<void>;
  placeholder: string;
  example: string;
  compact?: boolean;
  activity?: string | null;
}

export function VoiceControl({ onSubmit, placeholder, example, compact = false, activity }: VoiceControlProps) {
  const [text, setText] = useState("");
  const [lastHeard, setLastHeard] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { isListening, isProcessing, isSupported, error, phase, toggleListening } = useVoiceInput(async (transcript) => {
    setText(transcript);
    setLastHeard(transcript);
    await onSubmit(transcript);
  });

  async function submitText() {
    const value = text.trim();
    if (!value) return;
    setLastHeard(value);
    setIsSubmitting(true);
    try {
      await onSubmit(value);
    } finally {
      setIsSubmitting(false);
    }
  }

  const isBusy = isProcessing || isSubmitting;
  const status = phase === "uploading"
    ? "Uploading recording…"
    : phase === "transcribing"
      ? "Transcribing your audio…"
      : phase === "applying" || isSubmitting
        ? activity || "Processing your request…"
        : null;

  return (
    <div className={compact ? "voice-control compact" : "voice-control"}>
      <button
        className={isListening ? "mic-button listening" : "mic-button"}
        type="button"
        onClick={toggleListening}
        disabled={!isSupported || isBusy}
        aria-label={isListening ? "Stop listening" : "Start voice input"}
      >
        {isListening ? <Waveform size={30} weight="bold" /> : isBusy ? <span className="spin"><CircleNotch size={30} weight="bold" /></span> : <Microphone size={30} weight="fill" />}
      </button>
      <div className="voice-copy">
        <strong aria-live="polite">{isListening ? "Recording — tap to finish" : status || (isSupported ? "Tap to speak" : "Type your update")}</strong>
        <span>{isListening ? "Pause as long as you need. I’ll wait." : lastHeard ? `“${lastHeard}”` : example}</span>
      </div>
      <div className="voice-entry">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && void submitText()}
          disabled={isBusy}
          placeholder={placeholder}
          aria-label={placeholder}
        />
        <button type="button" onClick={() => void submitText()} disabled={isBusy} aria-label="Submit typed update">
          <PaperPlaneTilt size={19} weight="fill" />
        </button>
      </div>
      {error ? <p className="voice-error">{error}</p> : null}
    </div>
  );
}
