"use client";

import { useEffect, useRef, useState } from "react";

interface SpeechRecognitionEventLike extends Event {
  results: ArrayLike<{ 0: { transcript: string }; length: number }>;
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export function useVoiceInput(onTranscript: (text: string) => void) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const callbackRef = useRef(onTranscript);
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callbackRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      const timer = window.setTimeout(() => setIsSupported(false), 0);
      return () => window.clearTimeout(timer);
    }
    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (transcript) callbackRef.current(transcript);
    };
    recognition.onerror = (event) => {
      setError(event.error === "not-allowed" ? "Microphone permission is needed." : "I couldn’t hear that. Try again.");
      setIsListening(false);
    };
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    return () => recognition.stop();
  }, []);

  function toggleListening() {
    if (!recognitionRef.current) return;
    setError(null);
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }
    recognitionRef.current.start();
    setIsListening(true);
  }

  return { isListening, isSupported, error, toggleListening };
}
