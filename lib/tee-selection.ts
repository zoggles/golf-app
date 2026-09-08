import type { Course } from "./types";

export const COMMON_TEES = ["Forward", "Red", "Gold", "White", "Blue", "Black"];

const TEE_CONTEXT: Record<string, string> = {
  forward: "shortest option; less total distance and shorter approaches",
  red: "often a forward or shorter option",
  gold: "often a shorter or middle option; sometimes called senior tees, but varies by course",
  yellow: "often a forward or middle option",
  white: "often a middle-distance option",
  blue: "often a longer or back option",
  black: "often the longest or championship option",
  green: "meaning varies by course",
  silver: "meaning varies by course",
  orange: "often a forward or shorter option",
};

export function normalizeTee(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function teeDescription(tee: string) {
  return TEE_CONTEXT[normalizeTee(tee)] ?? "a course-specific tee; compare its total yardage, rating, and slope";
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

export function courseMatchesPhrase(course: Course, phrase: string) {
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
