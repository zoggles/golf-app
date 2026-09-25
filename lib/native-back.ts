"use client";

/**
 * Lets something on screen take the Android back button for itself, the way an open dialog
 * closes before the page underneath goes anywhere.
 */

const BACK_EVENT = "caddy-stack:back";

/** True when something on screen handled the press, so nothing else should. */
export function backPressClaimed(): boolean {
  return !window.dispatchEvent(new Event(BACK_EVENT, { cancelable: true }));
}

export function onBackPress(handler: () => void): () => void {
  const listener = (event: Event) => {
    event.preventDefault();
    handler();
  };
  window.addEventListener(BACK_EVENT, listener);
  return () => window.removeEventListener(BACK_EVENT, listener);
}
