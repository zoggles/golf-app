import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import { z } from "zod";
import { parseAiJson } from "@/lib/parse-ai-json";

export const maxDuration = 120;

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

type Course = z.infer<typeof courseSchema>;

function failCourseLookup(name: string, message: string): never {
  const error = new Error(message);
  error.name = name;
  throw error;
}

function parseCourseCandidates(candidates: string[]): Course | null {
  for (const candidate of candidates) {
    if (!candidate.trim()) continue;
    try {
      return parseAiJson(candidate, courseSchema);
    } catch {
      // A research step may contain prose or a tool call before the final JSON.
    }
  }
  return null;
}

function normalizeCourse(course: Course): Course {
  const holes = [...course.holes].sort((left, right) => left.number - right.number);
  const validLength = holes.length === 9 || holes.length === 18;
  const sequential = holes.every((hole, index) => hole.number === index + 1);
  if (!validLength || !sequential) {
    failCourseLookup("InvalidScorecardError", "Course scorecard must contain sequential holes for a complete 9- or 18-hole round.");
  }

  return {
    ...course,
    par: holes.reduce((total, hole) => total + hole.par, 0),
    yards: holes.reduce((total, hole) => total + hole.yards, 0),
    holes,
  };
}

function normalizeUrl(value: string): string {
  return value.replace(/\/$/, "");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { query?: unknown };
    const query = typeof body.query === "string" ? body.query.trim().slice(0, 300) : "";
    if (!query) return Response.json({ error: "Tell me the course name and location." }, { status: 400 });

    const result = await generateText({
      model: "google/gemini-2.5-flash-lite",
      maxOutputTokens: 8000,
      system: `You research golf courses for a live scorecard using Google Search grounding. Always search before answering. Identify the exact course from the user's wording. Prefer an official course scorecard or course website, then reputable golf directories. Return the complete 9- or 18-hole scorecard for one named tee; use White/Middle tees unless the user specifies another tee. Copy every par, yardage, handicap, rating, and slope from a retrieved source—never estimate factual scorecard data. If sources disagree, prefer the official scorecard. Suggested clubs and strategy are general, conservative guidance inferred from yardage. The id must be a stable lowercase slug including course and tee. sourceUrl must exactly match one of your grounded source URLs and directly support the scorecard. If the exact course cannot be confidently identified with a complete scorecard, do not substitute another course. Return only JSON matching the supplied schema.`,
      prompt: `Find and structure this golf course and tee for a scorecard: ${query}\n\nReturn only a JSON object matching this schema:\n${JSON.stringify(z.toJSONSchema(courseSchema))}`,
      tools: {
        google_search: google.tools.googleSearch({}),
      },
    });

    const structuredCourse = parseCourseCandidates([
      result.text,
      ...result.steps.toReversed().map((step) => step.text),
    ]);
    if (!structuredCourse) failCourseLookup("CourseStructureError", "Course research could not be converted to a complete scorecard.");

    const normalizedCourse = normalizeCourse(structuredCourse);
    const sourceUrls = result.sources
      .filter((source) => source.sourceType === "url")
      .map((source) => normalizeUrl(source.url));
    if (sourceUrls.length === 0) failCourseLookup("NoSearchEvidenceError", "Course research returned no grounded sources.");
    if (!sourceUrls.includes(normalizeUrl(normalizedCourse.sourceUrl))) {
      failCourseLookup("EvidenceSourceMismatchError", "The scorecard source was not returned by grounded search.");
    }
    return Response.json({ course: normalizedCourse });
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
