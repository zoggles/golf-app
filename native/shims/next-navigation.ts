import { useSyncExternalStore } from "react";

function currentPathname(): string {
  if (typeof window === "undefined") return "/play";
  const hash = window.location.hash.slice(1);
  return hash.startsWith("/") ? hash : "/play";
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

export function navigate(href: string, replace = false): void {
  const hash = href.startsWith("/") ? `#${href}` : `#/${href}`;
  if (replace) {
    window.history.replaceState(null, "", hash);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = hash;
  }
  window.scrollTo({ top: 0, behavior: "instant" });
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, currentPathname, () => "/play");
}

export function useRouter() {
  return {
    push: (href: string) => navigate(href),
    replace: (href: string) => navigate(href, true),
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    refresh: () => window.location.reload(),
    prefetch: async () => undefined,
  };
}
