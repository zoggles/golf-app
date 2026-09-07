"use client";

import { useEffect, useRef, useState } from "react";

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean; length: number }>;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export function useVoiceInput(onTranscript: (text: string) => void | Promise<void>) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const browserTranscriptRef = useRef("");
  const shouldListenRef = useRef(false);
  const callbackRef = useRef(onTranscript);
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callbackRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    const supported = Boolean(navigator.mediaDevices && typeof window.MediaRecorder !== "undefined");
    const timer = window.setTimeout(() => setIsSupported(supported), 0);
    return () => {
      window.clearTimeout(timer);
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      shouldListenRef.current = false;
      recognitionRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function startListening() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined);
      chunksRef.current = [];
      browserTranscriptRef.current = "";
      shouldListenRef.current = true;
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setError("The recording stopped unexpectedly. Please try again.");
        setIsListening(false);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setIsListening(false);
        const audio = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (!audio.size) return;
        setIsProcessing(true);
        try {
          const form = new FormData();
          form.append("audio", audio, recorder.mimeType.includes("mp4") ? "round.m4a" : "round.webm");
          const response = await fetch("/api/voice", { method: "POST", body: form });
          const result = (await response.json()) as { transcript?: string; error?: string };
          if (!response.ok || !result.transcript) throw new Error(result.error || "No speech was detected.");
          await callbackRef.current(result.transcript);
        } catch (cause) {
          const browserTranscript = browserTranscriptRef.current.trim();
          if (browserTranscript) await callbackRef.current(browserTranscript);
          else setError(cause instanceof Error ? cause.message : "I couldn’t transcribe that. Please try again.");
        } finally {
          setIsProcessing(false);
        }
      };
      recorder.start(1000);
      const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
      if (Recognition) {
        const recognition = new Recognition();
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.lang = "en-US";
        recognition.onresult = (event) => {
          for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const result = event.results[index];
            if (result.isFinal && result[0]?.transcript) browserTranscriptRef.current += ` ${result[0].transcript}`;
          }
        };
        recognition.onend = () => {
          if (shouldListenRef.current) {
            try { recognition.start(); } catch { /* A pending restart is harmless. */ }
          }
        };
        try {
          recognition.start();
          recognitionRef.current = recognition;
        } catch {
          recognitionRef.current = null;
        }
      }
      setIsListening(true);
    } catch (cause) {
      const denied = cause instanceof DOMException && (cause.name === "NotAllowedError" || cause.name === "SecurityError");
      setError(denied ? "Microphone permission is needed. You can still type below." : "I couldn’t start the microphone.");
    }
  }

  function toggleListening() {
    if (isProcessing) return;
    if (isListening) {
      shouldListenRef.current = false;
      recognitionRef.current?.stop();
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    } else {
      void startListening();
    }
  }

  return { isListening, isProcessing, isSupported, error, toggleListening };
}
