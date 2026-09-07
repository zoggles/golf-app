import { gateway } from "@ai-sdk/gateway";
import { experimental_transcribe as transcribe } from "ai";

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
    });

    return Response.json({ transcript: result.text.trim() });
  } catch (error) {
    console.error("Voice transcription failed", error);
    if (String(error).toLowerCase().includes("valid credit card")) {
      return Response.json({ error: "Cloud transcription is awaiting Vercel billing setup.", setupRequired: true }, { status: 503 });
    }
    return Response.json({ error: "I couldn’t transcribe that recording. Please try again or type the update." }, { status: 502 });
  }
}
