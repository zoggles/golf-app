import { generateText } from "ai";
import { z } from "zod";
import { parseAiJson } from "@/lib/parse-ai-json";

const commandSchema = z.object({
  updates: z.array(z.object({
    hole: z.number().int().min(1).max(18),
    strokes: z.number().int().min(1).max(20).optional(),
    metrics: z.object({
      putts: z.number().int().min(0).max(20).optional(),
      penaltyStrokes: z.number().int().min(0).max(20).optional(),
      fairway: z.enum(["hit", "miss"]).optional(),
      blowUp: z.boolean().optional(),
    }).optional(),
  }).refine((update) => update.strokes !== undefined || (update.metrics && Object.keys(update.metrics).length > 0), {
    message: "Each update needs a score or an explicitly stated metric.",
  })).max(18),
  reply: z.string().min(2).max(180),
});

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      text?: unknown;
      currentHole?: unknown;
      holes?: unknown;
      scores?: unknown;
    };
    const text = typeof body.text === "string" ? body.text.trim().slice(0, 500) : "";
    if (!text) return Response.json({ error: "No score update received." }, { status: 400 });

    const { text: resultText } = await generateText({
      model: "google/gemini-2.5-flash",
      maxOutputTokens: 600,
      providerOptions: {
        google: { thinkingConfig: { thinkingBudget: 0 } },
      },
      system: `Interpret natural-language updates to an active golf scorecard. A score is total strokes for a hole, never strokes relative to par. Resolve golf terms from the supplied hole pars: eagle is par-2, birdie par-1, par is par, bogey par+1, double bogey par+2, triple bogey par+3. Optional hole metrics are putts, penalty strokes, fairway hit or miss, and whether the golfer explicitly calls it a blow-up hole. The golfer may correct any current or past hole and may update several holes in one message. When the utterance explicitly names a hole, use that hole exactly; currentHole is only a default when no hole is named. Later corrections in the same message win. Include only scores and metrics the golfer clearly stated. Never infer a fairway result, putts, penalties, or a blow-up from the score or other context, and never turn a missing metric into zero. Return no updates and ask a concise clarifying question only when nothing is clear. Never alter a hole outside the supplied list.`,
      prompt: `${JSON.stringify({ utterance: text, currentHole: body.currentHole, holes: body.holes, existingScores: body.scores })}\n\nReturn only a JSON object matching this schema:\n${JSON.stringify(z.toJSONSchema(commandSchema))}`,
    });

    return Response.json(parseAiJson(resultText, commandSchema));
  } catch (error) {
    console.error("Round command failed", error);
    const diagnosticCode = error instanceof Error ? error.name : "UnknownError";
    if (String(error).toLowerCase().includes("valid credit card")) {
      return Response.json({ error: "AI interpretation is awaiting Vercel billing setup.", setupRequired: true }, { status: 503 });
    }
    return Response.json({ error: "I couldn’t understand that update. Try naming the hole and score.", diagnosticCode }, { status: 502 });
  }
}
