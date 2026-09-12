import { normalizeLocation, phraseContradictsLocation } from "./course-location";
import type { Course } from "./types";

export const COMMON_TEES = ["Forward", "Red", "Gold", "White", "Blue", "Black"];

const TEE_CONTEXT: Record<string, string> = {
  forward: "New golfers",
  red: "Women",
  gold: "Seniors",
  yellow: "Juniors",
  white: "Men",
  blue: "Advanced",
  black: "Expert",
  green: "Course-specific",
  silver: "Course-specific",
  orange: "Juniors",
};

export function normalizeTee(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function teeDescription(tee: string) {
  return TEE_CONTEXT[normalizeTee(tee)] ?? "Course-specific";
}

export function teeOptionLabel(tee: string) {
  return `${tee} — ${teeDescription(tee)}`;
}

function editDistance(left: string, right: string) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = row[0];
    row[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const previous = row[rightIndex];
      row[rightIndex] = Math.min(
        row[rightIndex] + 1,
        row[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = previous;
    }
  }
  return row[right.length];
}

function nameMatchesPhrase(course: Course, phrase: string) {
  const phraseWords = normalizeTee(phrase).split(" ").filter(Boolean);
  const ignoredWords = new Set(["the", "golf", "course", "club", "country", "at", "of"]);
  const names = [course.name, course.shortName];

  return names.some((name) => {
    const nameWords = normalizeTee(name).split(" ").filter((word) => word.length > 3 && !ignoredWords.has(word));
    return nameWords.length > 0 && nameWords.every((nameWord) =>
      phraseWords.some((phraseWord) => {
        if (phraseWord === nameWord) return true;
        const tolerance = nameWord.length >= 8 ? 2 : 1;
        return Math.abs(phraseWord.length - nameWord.length) <= tolerance && editDistance(phraseWord, nameWord) <= tolerance;
      }),
    );
  });
}

/**
 * Whether a saved course is the one a phrase is asking for.
 *
 * The name alone is not enough. Course names repeat across the country, and after the
 * generic words are dropped a name can come down to a single token — every Arrowhead in
 * America answers to "arrowhead". So a phrase that names a different place is treated as a
 * request for a course we do not have yet, which sends it to a fresh lookup instead of
 * silently loading the wrong scorecard.
 */
export function courseMatchesPhrase(course: Course, phrase: string) {
  if (!nameMatchesPhrase(course, phrase)) return false;
  return !phraseContradictsLocation(course.name, course.location, phrase);
}

export function samePhysicalCourse(left: Course, right: Course) {
  // Locations go through normalizeLocation so "Rochester, NY" and "Rochester, New York"
  // are one place; the catalogue holds both spellings for a single course.
  return (
    normalizeTee(left.name) === normalizeTee(right.name) &&
    normalizeLocation(left.location) === normalizeLocation(right.location)
  );
}

/** One entry per course for course pickers, preferring its verified White card. */
export function courseListOptions(courses: Course[]): Course[] {
  const options: Course[] = [];
  for (const course of courses) {
    const existingIndex = options.findIndex((candidate) => samePhysicalCourse(candidate, course));
    if (existingIndex < 0) {
      options.push(course);
    } else if (normalizeTee(course.tee) === "white" && normalizeTee(options[existingIndex].tee) !== "white") {
      options[existingIndex] = course;
    }
  }
  return options;
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
