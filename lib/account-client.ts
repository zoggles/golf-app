"use client";

import { apiUrl } from "./api-url";
import { authHeaders, signOutLocally } from "./auth-client";
import { clearGolferSession, readSelectedGolfer } from "./golfer-session";
import { clearLocalGolfDataForGolfer } from "./storage";

export async function deleteCurrentAccount(): Promise<void> {
  const golferId = readSelectedGolfer()?.id;
  const response = await fetch(apiUrl("/api/account"), { method: "DELETE", headers: authHeaders() });
  const result = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(result.error || "Could not delete your account.");
  if (golferId) clearLocalGolfDataForGolfer(golferId);
  await signOutLocally();
  clearGolferSession();
}
