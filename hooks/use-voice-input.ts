"use client";

import { useEffect, useRef, useState } from "react";

const PREFERRED_AUDIO_TYPES = [
  "audio/webm;codecs=opus",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/webm",
] as const;

function recordingName(mimeType: string) {
  if (mimeType.includes("mp4")) return "round.m4a";
  if (mimeType.includes("ogg")) return "round.ogg";
  return "round.webm";
}

async function openMicrophone() {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: { ideal: 1 },
        sampleRate: { ideal: 48_000 },
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "OverconstrainedError") {
      return navigator.mediaDevices.getUserMedia({ audio: true });
    }
    throw error;
  }
}

async function uploadRecording(audio: Blob, filename: string) {
  const form = new FormData();
  form.append("audio", audio, filename);
  const response = await fetch("/api/voice", { method: "POST", body: form });
  const result = (await response.json()) as { transcript?: string; error?: string };
  if (!response.ok || !result.transcript) throw new Error(result.error || "No speech was detected.");
  return result.transcript;
}

export function useVoiceInput(onTranscript: (text: string) => void | Promise<void>) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const callbackRef = useRef(onTranscript);
  const mountedRef = useRef(true);
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callbackRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    mountedRef.current = true;
    const supported = Boolean(navigator.mediaDevices && typeof window.MediaRecorder !== "undefined");
    const timer = window.setTimeout(() => setIsSupported(supported), 0);
    return () => {
      mountedRef.current = false;
      window.clearTimeout(timer);
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function startListening() {
    setError(null);
    try {
      const stream = await openMicrophone();
      const preferredType = PREFERRED_AUDIO_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, {
        ...(preferredType ? { mimeType: preferredType } : {}),
        audioBitsPerSecond: 96_000,
      });

      chunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (mountedRef.current) {
          setError("The recording stopped unexpectedly. Please try again.");
          setIsListening(false);
        }
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        if (!mountedRef.current) return;

        setIsListening(false);
        const actualType = recorder.mimeType || chunksRef.current[0]?.type || "audio/webm";
        const audio = new Blob(chunksRef.current, { type: actualType });
        if (!audio.size) {
          setError("No audio was captured. Please try again.");
          return;
        }

        setIsProcessing(true);
        try {
          const transcript = await uploadRecording(audio, recordingName(actualType));
          await callbackRef.current(transcript);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "I couldn’t transcribe that. Please try again.");
        } finally {
          if (mountedRef.current) setIsProcessing(false);
        }
      };

      // One complete file is more reliable than stitched timed chunks on mobile Chromium.
      recorder.start();
      setIsListening(true);
    } catch (cause) {
      const denied = cause instanceof DOMException && (cause.name === "NotAllowedError" || cause.name === "SecurityError");
      setError(denied ? "Microphone permission is needed. You can still type below." : "I couldn’t start the microphone.");
    }
  }

  function toggleListening() {
    if (isProcessing) return;
    if (isListening) {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    } else {
      void startListening();
    }
  }

  return { isListening, isProcessing, isSupported, error, toggleListening };
}
