"use client";

import { useSyncExternalStore } from "react";
import { readAuth, subscribeToAuth, type AuthState } from "@/lib/auth-client";

const SERVER_AUTH: AuthState = { session: undefined, error: null };

export function useAuth(): AuthState {
  return useSyncExternalStore(subscribeToAuth, readAuth, () => SERVER_AUTH);
}
