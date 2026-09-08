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

    const research = await generateText({
      model: "google/gemini-2.5-flash",
      maxOutputTokens: 7000,
      stopWhen: isStepCount(3),
      system: `You research golf courses for a live scorecard using Google Search grounding. Always search before answering. Resolve speech-to-text errors, phonetic spellings, and small misspellings by combining the requested name with its city/state; a near-match at the exact requested location is more likely than an exact-name match in another city. Search both the user's wording and promising corrected spellings. Prefer an official course scorecard or course website, then reputable golf directories that publish a complete hole-by-hole scorecard. Gather the exact published course name, location, tee name, full-course rating, slope, and every hole's number, par, yardage, and stroke index. If the course has 18 holes, collect all 18 even if the user only plans to play nine. Use the requested tee, or the course's middle/white tee when none is specified. Never estimate factual scorecard data and never substitute another course or tee. Provide a compact evidence report with source URLs; it does not need to be JSON.`,
      prompt: `Research the intended golf course and complete scorecard for: "${query}". Start with the full name-and-location phrase. If there is no exact result, search likely phonetic or spelling variants while keeping the requested city/state fixed. Search for an official scorecard PDF or official course page first, then a reputable complete scorecard directory.`,
      tools: {
        google_search: google.tools.googleSearch({}),
      },
    });

    const evidence = [
      research.text,
      ...research.steps.map((step) => step.text),
      `Grounded sources: ${JSON.stringify(research.sources)}`,
    ].filter(Boolean).join("\n\n");
    if (!evidence.trim() || research.sources.length === 0) {
      failCourseLookup("NoSearchEvidenceError", "Course research returned no grounded sources.");
    }

    const structured = await generateText({
      model: "google/gemini-2.5-flash-lite",
      maxOutputTokens: 8000,
      output: Output.object({ schema: courseSchema }),
      system: `Convert grounded golf-course research into the supplied scorecard structure. Use only factual course data present in the evidence. Use the exact corrected published course name and selected tee. Rating, slope, par, yards, and all holes must describe the same tee and full course. Preserve published par, yardage, and stroke index exactly. You may create concise suggestedClub and strategy values from each hole's par and yardage. Use a stable lowercase id containing course and tee. sourceUrl must be one of the grounded URLs in the evidence and must support the scorecard.`,
      prompt: `Structure this grounded research into a complete course scorecard:\n\n${evidence}`,
    });

    const structuredCourse = structured.output;
    if (!structuredCourse) failCourseLookup("CourseStructureError", "Course research could not be converted to a complete scorecard.");

    const normalizedCourse = normalizeCourse(structuredCourse);
    return Response.json({ course: normalizedCourse });
  } catch (error) {
    console.error("Course lookup failed", error);
    const diagnosticCode = error instanceof Error ? error.name : "UnknownError";
    if (/valid credit card|free tier users do not have access/i.test(String(error))) {
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
