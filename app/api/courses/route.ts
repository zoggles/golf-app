import { persistenceErrorResponse } from "@/lib/api-errors";
import { resolveAuthenticatedGolferId } from "@/lib/auth-server";
import { parseCoursePayload } from "@/lib/golf-payloads";
import { deleteCourseRow, saveCourseRow } from "@/lib/supabase-server";

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

/**
 * Forgets a course. Used when research lands on the right name in the wrong place, which
 * otherwise leaves an unusable entry in everyone's picker with no way to clear it.
 */
export async function DELETE(request: Request) {
  try {
    await resolveAuthenticatedGolferId(request);
    const courseId = new URL(request.url).searchParams.get("id");
    if (!courseId) return Response.json({ error: "A course id is required." }, { status: 400 });

    const outcome = await deleteCourseRow(courseId);
    if (outcome === "in-use") {
      return Response.json(
        { error: "That course has rounds recorded on it, so it is kept." },
        { status: 409 },
      );
    }
    return Response.json({ deleted: courseId });
  } catch (cause) {
    return persistenceErrorResponse(cause);
  }
}
