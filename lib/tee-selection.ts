import type { Course } from "./types";

export const COMMON_TEES = ["Forward", "Red", "Gold", "White", "Blue", "Black"];

export function normalizeTee(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function samePhysicalCourse(left: Course, right: Course) {
  return normalizeTee(left.name) === normalizeTee(right.name) && normalizeTee(left.location) === normalizeTee(right.location);
}

export function extractTeeMention(text: string): string | null {
  const namedTee = text.match(/\b(forward|red|gold|yellow|white|blue|black|green|silver|orange|women'?s|lad(?:y|ies))\s+tees?\b/i);
  const playingFrom = text.match(/\b(?:from|off|using)\s+(?:the\s+)?(forward|red|gold|yellow|white|blue|black|green|silver|orange)\b/i);
  const match = namedTee ?? playingFrom;
  if (!match) return null;
  const tee = match[1].toLowerCase();
  if (tee.startsWith("women") || tee.startsWith("lad")) return "Forward";
  return tee[0].toUpperCase() + tee.slice(1);
}
