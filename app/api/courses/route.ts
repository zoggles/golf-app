import { persistenceErrorResponse } from "@/lib/api-errors";
import { resolveAuthenticatedGolferId } from "@/lib/auth-server";
import { parseCoursePayload } from "@/lib/golf-payloads";
import { saveCourseRow } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * Upserts one course scorecard. Courses are a shared catalogue rather than one
 * golfer's data, but writing to it still takes a known golfer so the whole
 * persistence surface answers to the same check.
 */
export async function POST(request: Request) {
  try {
    await resolveAuthenticatedGolferId(request);
    const course = parseCoursePayload(await request.json());
    return Response.json({ course: await saveCourseRow(course) });
  } catch (cause) {
    return persistenceErrorResponse(cause);
  }
}
