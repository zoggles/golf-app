import { keepSupabaseActive } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/** A Vercel Cron invocation that prevents an idle Free Plan database from pausing. */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ ok: false }, { status: 401 });
  }

  try {
    await keepSupabaseActive();
    return Response.json({ ok: true });
  } catch (cause) {
    console.error("Supabase keep-alive failed", cause);
    return Response.json({ ok: false }, { status: 503 });
  }
}
