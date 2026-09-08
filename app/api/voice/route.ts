import { gateway } from "@ai-sdk/gateway";
import { transcribe } from "ai";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const audio = form.get("audio");
    if (!(audio instanceof File)) return Response.json({ error: "No recording received." }, { status: 400 });
    if (audio.size > 15 * 1024 * 1024) return Response.json({ error: "That recording is too large. Try a shorter update." }, { status: 413 });

    const result = await transcribe({
      model: gateway.transcriptionModel("openai/gpt-4o-mini-transcribe"),
      audio: new Uint8Array(await audio.arrayBuffer()),
      providerOptions: {
        openai: {
          language: "en",
          prompt: "Golf round dictation. Expect golf course names, hole numbers, stroke counts, pars, bogeys, birdies, eagles, putts, penalties, clubs, fairways, and greens in regulation.",
        },
        gateway: {
          tags: ["feature:voice-transcription", "app:golf-app"],
        },
      },
      abortSignal: AbortSignal.timeout(45_000),
    });

    return Response.json({ transcript: result.text.trim() });
  } catch (error) {
    console.error("Voice transcription failed", error);
    const nestedCodes = error && typeof error === "object" && "errors" in error && Array.isArray(error.errors)
      ? error.errors.map((item) => item instanceof Error ? item.name : "UnknownNestedError")
      : [];
    const diagnosticCode = [error instanceof Error ? error.name : "UnknownError", ...nestedCodes].join(":");
    if (String(error).toLowerCase().includes("valid credit card")) {
      return Response.json({ error: "Cloud transcription is awaiting Vercel billing setup.", setupRequired: true }, { status: 503 });
    }
    return Response.json({ error: "I couldn’t transcribe that recording. Please try again or type the update.", diagnosticCode }, { status: 502 });
  }
}
