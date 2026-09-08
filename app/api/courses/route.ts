import { persistenceErrorResponse } from "@/lib/api-errors";
import { parseCoursePayload } from "@/lib/golf-payloads";
import { saveCourseRow } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/** Upserts one course scorecard. */
export async function POST(request: Request) {
  try {
    const course = parseCoursePayload(await request.json());
    return Response.json({ course: await saveCourseRow(course) });
  } catch (cause) {
    return persistenceErrorResponse(cause);
  }
}
