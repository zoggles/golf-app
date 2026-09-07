import { COURSES, GENESEE_VALLEY_SOUTH, getCourse } from "./courses";
import type { RoundSegment } from "./types";

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
  courseId: string;
  segment: RoundSegment;
  understood: boolean;
}

export interface ScoreCommand {
  hole: number;
  strokes: number;
}

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
    courseId: course?.id ?? GENESEE_VALLEY_SOUTH.id,
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
      const offsets: Record<string, number> = {
        birdie: -1,
        par: 0,
        bogey: 1,
        "double bogey": 2,
        "triple bogey": 3,
      };
      strokes = targetHole.par + offsets[golfTerm[1]];
    }
  }

  if (!holeNumber || !strokes) return null;
  if (holeNumber < 1 || holeNumber > 18 || strokes < 1 || strokes > 20) return null;
  return { hole: holeNumber, strokes };
}
