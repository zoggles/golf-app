import { generateText, gateway, isStepCount } from "ai";
import { z } from "zod";
import { parseAiJson } from "@/lib/parse-ai-json";

export const maxDuration = 60;

const holeSchema = z.object({
  number: z.number().int().min(1).max(18),
  par: z.number().int().min(3).max(6),
  yards: z.number().int().min(50).max(800),
  handicap: z.number().int().min(1).max(18),
  suggestedClub: z.string().min(2),
  strategy: z.string().min(8),
});

const courseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(3),
  shortName: z.string().min(3),
  location: z.string().min(2),
  tee: z.string().min(2),
  rating: z.number().min(25).max(85),
  slope: z.number().int().min(55).max(155),
  par: z.number().int().min(27).max(80),
  yards: z.number().int().min(1200).max(8500),
  sourceUrl: z.string().url(),
  holes: z.array(holeSchema).min(9).max(18),
});

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { query?: unknown };
    const query = typeof body.query === "string" ? body.query.trim().slice(0, 300) : "";
    if (!query) return Response.json({ error: "Tell me the course name and location." }, { status: 400 });

    const { text } = await generateText({
      model: "inclusionai/ling-3.0-flash-sante-free",
      system: `You research golf courses for a live scorecard. Always use web search before answering. Identify the exact course from the user's wording. Prefer an official course scorecard or course website, then reputable golf directories. Return the complete 9- or 18-hole scorecard for one named tee; use White/Middle tees unless the user specifies another tee. Never fabricate missing hole pars, yardages, rating, or slope. If sources disagree, prefer the official scorecard. Suggested clubs and strategy are general, conservative guidance inferred from yardage—not factual course data. The id must be a stable lowercase slug including course and tee. sourceUrl must be the best page or PDF supporting the scorecard. If the exact course cannot be confidently identified with a complete scorecard, throw an error rather than substituting another course.`,
      prompt: `Find and structure this golf course and tee for a scorecard: ${query}\n\nReturn only a JSON object matching this schema:\n${JSON.stringify(z.toJSONSchema(courseSchema))}`,
      tools: {
        web_search: gateway.tools.perplexitySearch({
          maxResults: 8,
          maxTokens: 30000,
          maxTokensPerPage: 5000,
          country: "US",
          searchLanguageFilter: ["en"],
        }),
      },
      stopWhen: isStepCount(4),
    });

    return Response.json({ course: parseAiJson(text, courseSchema) });
  } catch (error) {
    console.error("Course lookup failed", error);
    const diagnosticCode = error instanceof Error ? error.name : "UnknownError";
    if (String(error).toLowerCase().includes("valid credit card")) {
      return Response.json(
        { error: "Live course research is ready, but this Vercel team must add a payment method to unlock its AI Gateway credits.", setupRequired: true },
        { status: 503 },
      );
    }
    return Response.json(
      { error: "I couldn’t verify a complete scorecard for that course. Add the city/state or a more exact course name and try again.", diagnosticCode },
      { status: 502 },
    );
  }
}
