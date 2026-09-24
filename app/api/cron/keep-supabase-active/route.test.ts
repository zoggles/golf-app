import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { keepSupabaseActive } = vi.hoisted(() => ({
  keepSupabaseActive: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({ keepSupabaseActive }));

import { GET } from "./route";

describe("Supabase keep-alive cron route", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-cron-secret";
    keepSupabaseActive.mockReset();
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("rejects requests without the cron bearer token", async () => {
    const response = await GET(new Request("https://example.test/api/cron/keep-supabase-active"));

    expect(response.status).toBe(401);
    expect(keepSupabaseActive).not.toHaveBeenCalled();
  });

  it("runs the read-only activity requests for an authenticated invocation", async () => {
    const response = await GET(
      new Request("https://example.test/api/cron/keep-supabase-active", {
        headers: { authorization: "Bearer test-cron-secret" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(keepSupabaseActive).toHaveBeenCalledOnce();
  });

  it("returns a retryable failure when Supabase is unavailable", async () => {
    keepSupabaseActive.mockRejectedValueOnce(new Error("database unavailable"));
    vi.spyOn(console, "error").mockImplementationOnce(() => undefined);

    const response = await GET(
      new Request("https://example.test/api/cron/keep-supabase-active", {
        headers: { authorization: "Bearer test-cron-secret" },
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false });
  });
});
