"use client";

import { useState } from "react";
import { Microphone, PaperPlaneTilt, Waveform } from "@phosphor-icons/react";
import { useVoiceInput } from "@/hooks/use-voice-input";

interface VoiceControlProps {
  onSubmit: (text: string) => void;
  placeholder: string;
  example: string;
  compact?: boolean;
}

export function VoiceControl({ onSubmit, placeholder, example, compact = false }: VoiceControlProps) {
  const [text, setText] = useState("");
  const [lastHeard, setLastHeard] = useState("");
  const { isListening, isSupported, error, toggleListening } = useVoiceInput((transcript) => {
    setText(transcript);
    setLastHeard(transcript);
    onSubmit(transcript);
  });

  function submitText() {
    const value = text.trim();
    if (!value) return;
    setLastHeard(value);
    onSubmit(value);
  }

  return (
    <div className={compact ? "voice-control compact" : "voice-control"}>
      <button
        className={isListening ? "mic-button listening" : "mic-button"}
        type="button"
        onClick={toggleListening}
        disabled={!isSupported}
        aria-label={isListening ? "Stop listening" : "Start voice input"}
      >
        {isListening ? <Waveform size={30} weight="bold" /> : <Microphone size={30} weight="fill" />}
      </button>
      <div className="voice-copy">
        <strong>{isListening ? "Listening…" : isSupported ? "Tap to speak" : "Type your update"}</strong>
        <span>{lastHeard ? `“${lastHeard}”` : example}</span>
      </div>
      <div className="voice-entry">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && submitText()}
          placeholder={placeholder}
          aria-label={placeholder}
        />
        <button type="button" onClick={submitText} aria-label="Submit typed update">
          <PaperPlaneTilt size={19} weight="fill" />
        </button>
      </div>
      {error ? <p className="voice-error">{error}</p> : null}
    </div>
  );
}
