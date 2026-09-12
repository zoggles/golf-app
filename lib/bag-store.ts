"use client";

import type { Bag } from "./bag";
import { DEFAULT_BAG, normalizeBag } from "./bag";

/**
 * Club distances, per golfer, on this device only.
 *
 * Deliberately not synced: it is thirteen numbers, and re-entering them costs half a
 * minute. A table earns its keep once carries are learned from recorded shots.
 */

const KEY_PREFIX = "caddy-stack:bag:v1:";
const CHANGE_EVENT = "caddy-stack:bag-change";

const cache = new Map<string, Bag>();

function storageKey(golferId: string): string {
  return `${KEY_PREFIX}${golferId}`;
}

export function readBag(golferId: string | null): Bag {
  if (!golferId || typeof window === "undefined") return DEFAULT_BAG;

  const cached = cache.get(golferId);
  if (cached) return cached;

  let bag = DEFAULT_BAG;
  try {
    const raw = window.localStorage.getItem(storageKey(golferId));
    if (raw) bag = normalizeBag(JSON.parse(raw));
  } catch {
    bag = DEFAULT_BAG;
  }
  cache.set(golferId, bag);
  return bag;
}

export function saveBag(golferId: string, bag: Bag): void {
  const normalized = normalizeBag(bag);
  cache.set(golferId, normalized);
  try {
    window.localStorage.setItem(storageKey(golferId), JSON.stringify(normalized));
  } catch {
    // Storage can be blocked; the in-memory copy still carries the round.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function resetBag(golferId: string): void {
  cache.delete(golferId);
  try {
    window.localStorage.removeItem(storageKey(golferId));
  } catch {
    // Nothing to clean up if storage was never writable.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeToBag(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && !event.key.startsWith(KEY_PREFIX)) return;
    cache.clear();
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
