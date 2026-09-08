import { COURSES, GENESEE_VALLEY_SOUTH, getCourse } from "./courses";
import type { Course, RoundSegment } from "./types";

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
};

export interface StartCommand {
  courseId: string | null;
  segment: RoundSegment;
  understood: boolean;
}

export interface ScoreCommand {
  hole: number;
  strokes: number;
}

export function nextHoleAfterVoiceUpdates(
  holeNumbers: number[],
  scores: Record<number, number>,
  currentHole: number,
  updates: ScoreCommand[],
): number {
  if (!updates.some((update) => update.hole === currentHole)) return currentHole;

  const updatedScores = { ...scores };
  for (const update of updates) updatedScores[update.hole] = update.strokes;
  const currentIndex = holeNumbers.indexOf(currentHole);
  const laterUnscored = holeNumbers.slice(currentIndex + 1).find((hole) => updatedScores[hole] == null);
  return laterUnscored ?? holeNumbers.find((hole) => updatedScores[hole] == null) ?? currentHole;
}

const SCORE_OFFSETS: Record<string, number> = {
  eagle: -2,
  birdie: -1,
  par: 0,
  bogey: 1,
  "double bogey": 2,
  "triple bogey": 3,
};

function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/[,.!?]/g, " ")
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen)\b/g, (word) => String(NUMBER_WORDS[word]))
    .replace(/\s+/g, " ")
    .trim();
}

export function parseStartCommand(input: string): StartCommand {
  const text = normalize(input);
  let segment: RoundSegment = "full18";
  if (/\b(front|first)\s*9\b/.test(text)) segment = "front9";
  if (/\b(back|last)\s*9\b/.test(text)) segment = "back9";
  const course = COURSES.find((candidate) => {
    const words = candidate.shortName.toLowerCase().split(/\s+/);
    return words.filter((word) => word.length > 4).every((word) => text.includes(word));
  });
  const mentionsGeneseeSouth = /gene+s+e+e|gennessee/.test(text) && text.includes("south");
  return {
    courseId: course?.id ?? (mentionsGeneseeSouth ? GENESEE_VALLEY_SOUTH.id : null),
    segment,
    understood: Boolean(course || mentionsGeneseeSouth),
  };
}

export function parseScoreCommand(
  input: string,
  courseId: string,
  currentHole?: number,
): ScoreCommand | null {
  const text = normalize(input);
  let holeNumber: number | undefined;
  let strokes: number | undefined;

  const holeReference = text.match(/\bhole\s*(\d{1,2})\b/);
  if (holeReference) holeNumber = Number(holeReference[1]);

  const holeFirst = text.match(/\bhole\s*(\d{1,2})\b(?:\D+)(\d{1,2})\b/);
  if (holeFirst) {
    holeNumber = Number(holeFirst[1]);
    strokes = Number(holeFirst[2]);
  }

  if (!holeFirst) {
    const scoreFirst = text.match(/\b(\d{1,2})\s*(?:strokes?|shots?)?\s*(?:on|for)\s*(?:hole\s*)?(\d{1,2})\b/);
    if (scoreFirst) {
      strokes = Number(scoreFirst[1]);
      holeNumber = Number(scoreFirst[2]);
    }
  }

  if (!holeNumber && currentHole) {
    holeNumber = currentHole;
    const simpleScore = text.match(/\b(\d{1,2})\s*(?:strokes?|shots?)?\b/);
    if (simpleScore) strokes = Number(simpleScore[1]);
  }

  const golfTerm = text.match(/\b(double bogey|triple bogey|birdie|bogey|par)\b/);
  if (golfTerm && holeNumber) {
    const targetHole = getCourse(courseId).holes.find((item) => item.number === holeNumber);
    if (targetHole) {
      strokes = targetHole.par + SCORE_OFFSETS[golfTerm[1]];
    }
  }

  if (!holeNumber || !strokes) return null;
  if (holeNumber < 1 || holeNumber > 18 || strokes < 1 || strokes > 20) return null;
  return { hole: holeNumber, strokes };
}

export function parseScoreCommands(input: string, course: Course, currentHole?: number): ScoreCommand[] {
  const text = normalize(input);
  const updates = new Map<number, number>();
  const holePattern = /\bhole\s*(\d{1,2})\b/g;
  const matches = [...text.matchAll(holePattern)];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const holeNumber = Number(match[1]);
    const end = matches[index + 1]?.index ?? text.length;
    const clause = text.slice((match.index ?? 0) + match[0].length, end);
    const targetHole = course.holes.find((hole) => hole.number === holeNumber);
    if (!targetHole) continue;
    const term = clause.match(/\b(double bogey|triple bogey|eagle|birdie|bogey|par)\b/);
    const numeric = clause.match(/\b(?:to|was|is|at|with|for)?\s*(\d{1,2})\s*(?:strokes?|shots?)?\b/);
    const strokes = term ? targetHole.par + SCORE_OFFSETS[term[1]] : numeric ? Number(numeric[1]) : undefined;
    if (strokes && strokes >= 1 && strokes <= 20) updates.set(holeNumber, strokes);
  }

  for (const match of text.matchAll(/\b(\d{1,2})\s*(?:strokes?|shots?)?\s*(?:on|for)\s*(?:hole\s*)?(\d{1,2})\b/g)) {
    const strokes = Number(match[1]);
    const holeNumber = Number(match[2]);
    if (course.holes.some((hole) => hole.number === holeNumber) && strokes >= 1 && strokes <= 20) updates.set(holeNumber, strokes);
  }

  if (!updates.size && currentHole) {
    const targetHole = course.holes.find((hole) => hole.number === currentHole);
    const term = text.match(/\b(double bogey|triple bogey|eagle|birdie|bogey|par)\b/);
    const numeric = text.match(/\b(\d{1,2})\s*(?:strokes?|shots?)?\b/);
    const strokes = term && targetHole ? targetHole.par + SCORE_OFFSETS[term[1]] : numeric ? Number(numeric[1]) : undefined;
    if (strokes && strokes >= 1 && strokes <= 20) updates.set(currentHole, strokes);
  }

  return [...updates].map(([hole, strokes]) => ({ hole, strokes }));
}
