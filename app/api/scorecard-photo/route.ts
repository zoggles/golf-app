import { generateText } from "ai";
import { z } from "zod";
import { parseAiJson } from "@/lib/parse-ai-json";
import { scorecardReadingSchema } from "@/lib/scorecard-import";

export const maxDuration = 120;

const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

/** Reads a photographed paper scorecard into structured holes and player columns. */
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const photo = form.get("photo");
    if (!(photo instanceof File)) return Response.json({ error: "No scorecard photo received." }, { status: 400 });
    if (photo.size > MAX_PHOTO_BYTES) {
      return Response.json({ error: "That photo is too large. Try a single, closer shot of the card." }, { status: 413 });
    }
    const mediaType = photo.type || "image/jpeg";
    if (!ACCEPTED_TYPES.includes(mediaType)) {
      return Response.json({ error: "Send a JPEG, PNG, WebP, or HEIC photo of the scorecard." }, { status: 415 });
    }

    const image = new Uint8Array(await photo.arrayBuffer());
    return Response.json({ reading: await readCard(image, mediaType) });
  } catch (error) {
    console.error("Scorecard photo read failed", error);
    const diagnosticCode = error instanceof Error ? error.name : "UnknownError";
    if (String(error).toLowerCase().includes("valid credit card")) {
      return Response.json({ error: "Scorecard scanning is awaiting Vercel billing setup.", setupRequired: true }, { status: 503 });
    }
    return Response.json(
      { error: "I couldn’t read that scorecard. Retake it flat and well lit, with every hole column in frame.", diagnosticCode },
      { status: 502 },
    );
  }
}

/**
 * Transcribes the card. A card whose columns are all legible still comes back
 * short of a full nine now and then, so one clean retry costs far less than
 * sending the golfer back out to photograph the card again.
 */
async function readCard(image: Uint8Array, mediaType: string) {
  let lastCause: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { text } = await generateText({
      model: "google/gemini-2.5-flash",
      maxOutputTokens: 4000,
      temperature: 0,
      system: `You read photographs of paper golf scorecards and transcribe exactly what is printed or written on them. Report the course name, location, tee, and date only when they are legible on the card; return an empty string otherwise, and never guess a course you cannot read. Give the date as YYYY-MM-DD whatever style the card prints it in. Include the course rating and slope printed for that tee when the card shows them, since the handicap estimate depends on them; leave them out rather than estimating. Return one entry in "holes" for every hole column the card shows, with the printed par and, when printed, the yardage and stroke index or handicap. Return one entry in "players" for every scored column, in left-to-right order, using the handwritten name when there is one. A score is the total strokes written for that hole, never strokes relative to par; omit a hole from a player's scores when its box is blank or unreadable rather than inventing a number. Ignore running totals, out/in subtotals, and net or putt rows. Use "note" for anything the golfer should double-check, such as smudged digits.`,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", image, mediaType },
            {
              type: "text",
              text: `Transcribe this golf scorecard.${attempt === 0 ? "" : " The previous attempt missed hole columns; work across the card left to right and account for every one."}\n\nReturn only a JSON object matching this schema:\n${JSON.stringify(z.toJSONSchema(scorecardReadingSchema))}`,
            },
          ],
        },
      ],
    });

    try {
      return parseAiJson(text, scorecardReadingSchema);
    } catch (cause) {
      lastCause = cause;
    }
  }
  throw lastCause;
}
