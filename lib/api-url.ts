import { Capacitor } from "@capacitor/core";

export const CADDY_STACK_API_ORIGIN = "https://caddy-stack.vercel.app";

export function resolveApiUrl(path: string, isNative: boolean): string {
  if (!path.startsWith("/")) throw new Error("API paths must start with a slash.");
  return isNative ? `${CADDY_STACK_API_ORIGIN}${path}` : path;
}

/**
 * The website calls its same-origin Next.js handlers. The installed Android app
 * ships its UI locally, so those same requests are directed to the Vercel API.
 */
export function apiUrl(path: string): string {
  return resolveApiUrl(path, typeof window !== "undefined" && Capacitor.isNativePlatform());
}
