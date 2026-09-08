import { google } from "@ai-sdk/google";
import { generateText, isStepCount, Output } from "ai";
import { z } from "zod";

export const maxDuration = 120;

const holeSchema = z.object({
  number: z.number().int().min(1).max(18).describe("Hole number in playing order"),
  par: z.number().int().min(3).max(6).describe("Published par for this hole and selected tee/player rating"),
  yards: z.number().int().min(50).max(800).describe("Published yardage from the selected tee"),
  handicap: z.number().int().min(1).max(18).describe("Published stroke index or hole handicap"),
  suggestedClub: z.string().min(2).describe("Practical starting club based on this tee's yardage"),
  strategy: z.string().min(8).describe("Brief hole strategy based on this tee's yardage"),
});

const courseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(3).describe("Exact published course name, correcting phonetic or spelling errors in the request"),
  shortName: z.string().min(3).describe("Concise recognizable course name"),
  location: z.string().min(2).describe("Published city and state/province"),
  tee: z.string().min(2).describe("Exact published name or color of the selected tee"),
  rating: z.number().min(25).max(85).describe("Published full-course rating for the selected tee"),
  slope: z.number().int().min(55).max(155).describe("Published full-course slope for the selected tee"),
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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { query?: unknown };
    const query = typeof body.query === "string" ? body.query.trim().slice(0, 300) : "";
    if (!query) return Response.json({ error: "Tell me the course name and location." }, { status: 400 });

    const result = await generateText({
      model: "google/gemini-3.8-flash",
      maxOutputTokens: 8000,
      output: Output.object({ schema: courseSchema }),
      stopWhen: isStepCount(4),
      system: `You research golf courses for a live scorecard using Google Search grounding. Always search before answering. Resolve speech-to-text errors, phonetic spellings, and small misspellings by combining the requested name with its city/state; for example, a near-match at the exact requested location is more likely than an exact-name match in another city. Search both the user's wording and promising corrected spellings. Prefer an official course scorecard or course website, then reputable golf directories that publish a complete hole-by-hole scorecard. If the course has 18 holes, always return its complete 18-hole scorecard even when the requested round is only the front or back nine; return 9 holes only when the course itself has exactly 9 holes. Use White/Middle tees only when the user does not specify a tee. When a tee is specified, use that exact published tee and never silently substitute White/Middle. Treat women's or ladies' tee requests as a request for the course's adult forward tee; return the actual published name or color. Copy every par, yardage, handicap, rating, and slope from retrieved sources—never estimate factual scorecard data. Rating, slope, par, and yards must describe the selected tee's full scorecard. If sources disagree, prefer the official scorecard. Recalculate suggested clubs and strategy from the selected tee's yardages. The id must be a stable lowercase slug including course and tee. sourceUrl must exactly match one of your grounded source URLs and directly support the scorecard. Never substitute a different course or tee when the evidence is insufficient.`,
      prompt: `Find the intended golf course and its complete published scorecard for: "${query}". Start with the full name-and-location phrase. If there is no exact result, search likely phonetic or spelling variants while keeping the requested city/state fixed. Search for an official scorecard PDF or official course page first, then a reputable complete scorecard directory. Return the requested tee, or the course's middle/white tee when no tee was requested.`,
      tools: {
        google_search: google.tools.googleSearch({}),
      },
    });

    const structuredCourse = result.output;
    if (!structuredCourse) failCourseLookup("CourseStructureError", "Course research could not be converted to a complete scorecard.");

    const normalizedCourse = normalizeCourse(structuredCourse);
    const groundingEvidence = JSON.stringify({ sources: result.sources, providerMetadata: result.providerMetadata });
    if (!groundingEvidence.includes("grounding") && result.sources.length === 0) {
      failCourseLookup("NoSearchEvidenceError", "Course research returned no grounded sources.");
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
