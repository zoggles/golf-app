import { COURSES, GENESEE_VALLEY_SOUTH, getCourse } from "./courses";
import type { Course, HoleMetrics, RoundSegment } from "./types";

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

export interface HoleMetricCommand {
  hole: number;
  metrics: HoleMetrics;
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
  return parseScoreCommands(input, getCourse(courseId), currentHole)[0] ?? null;
}

function numericScoreFromClause(clause: string): number | undefined {
  const labeled = clause.match(/\b(\d{1,2})\s*(?:strokes?|shots?)\b/);
  if (labeled) return Number(labeled[1]);
  const stated = clause.match(/\b(?:scored|score|shot|carded|made)\s*(?:a\s*)?(\d{1,2})\b/);
  if (stated) return Number(stated[1]);
  const linked = clause.match(/\b(?:to|was|is|at|for)\s*(\d{1,2})\b(?!\s*(?:putts?|penalt))/);
  if (linked) return Number(linked[1]);
  const bare = clause.trim().match(/^(\d{1,2})$/);
  return bare ? Number(bare[1]) : undefined;
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
    const numeric = numericScoreFromClause(clause);
    const strokes = term ? targetHole.par + SCORE_OFFSETS[term[1]] : numeric;
    if (strokes && strokes >= 1 && strokes <= 20) updates.set(holeNumber, strokes);
  }

  for (const match of text.matchAll(/\b(\d{1,2})\s*(?:strokes?|shots?)?\s*(?:on|for)\s*(?:hole\s*)?(\d{1,2})\b/g)) {
    const strokes = Number(match[1]);
    const holeNumber = Number(match[2]);
    if (course.holes.some((hole) => hole.number === holeNumber) && strokes >= 1 && strokes <= 20) updates.set(holeNumber, strokes);
  }

  for (const match of text.matchAll(/\b(double bogey|triple bogey|eagle|birdie|bogey|par)\s*(?:on|for)\s*(?:hole\s*)?(\d{1,2})\b/g)) {
    const holeNumber = Number(match[2]);
    const targetHole = course.holes.find((hole) => hole.number === holeNumber);
    if (targetHole) updates.set(holeNumber, targetHole.par + SCORE_OFFSETS[match[1]]);
  }

  if (!updates.size && currentHole) {
    const targetHole = course.holes.find((hole) => hole.number === currentHole);
    const term = text.match(/\b(double bogey|triple bogey|eagle|birdie|bogey|par)\b/);
    const numeric = numericScoreFromClause(text);
    const strokes = term && targetHole ? targetHole.par + SCORE_OFFSETS[term[1]] : numeric;
    if (strokes && strokes >= 1 && strokes <= 20) updates.set(currentHole, strokes);
  }

  return [...updates].map(([hole, strokes]) => ({ hole, strokes }));
}

function metricsFromClause(clause: string): HoleMetrics {
  const metrics: HoleMetrics = {};
  const putts = clause.match(/\b(\d{1,2})\s*putts?\b/);
  const penalties = clause.match(/\b(\d{1,2})\s*penalt(?:y|ies)(?:\s*strokes?)?\b/);
  if (putts) metrics.putts = Number(putts[1]);
  if (penalties) metrics.penaltyStrokes = Number(penalties[1]);
  else if (/\b(?:no|zero)\s+penalt(?:y|ies)\b/.test(clause)) metrics.penaltyStrokes = 0;
  else if (/\b(?:a|one)\s+penalty(?:\s+stroke)?\b/.test(clause)) metrics.penaltyStrokes = 1;

  if (/\b(?:missed|miss)\s+(?:the\s+)?fairway\b|\bfairway\s+miss\b|\bdid\s+not\s+hit\s+(?:the\s+)?fairway\b/.test(clause)) {
    metrics.fairway = "miss";
  } else if (/\bhit\s+(?:the\s+)?fairway\b|\bfairway\s+hit\b|\bin\s+(?:the\s+)?fairway\b/.test(clause)) {
    metrics.fairway = "hit";
  }

  if (/\b(?:not|wasn'?t)\s+(?:a\s+)?blow[ -]?up\b/.test(clause)) metrics.blowUp = false;
  else if (/\bblow[ -]?up\b/.test(clause)) metrics.blowUp = true;
  return metrics;
}

/** Extracts only explicitly spoken optional stats; an absent stat stays unknown. */
export function parseHoleMetricCommands(input: string, course: Course, currentHole?: number): HoleMetricCommand[] {
  const text = normalize(input);
  const commands: HoleMetricCommand[] = [];
  const matches = [...text.matchAll(/\bhole\s*(\d{1,2})\b/g)];

  if (matches.length) {
    for (let index = 0; index < matches.length; index += 1) {
      const hole = Number(matches[index][1]);
      if (!course.holes.some((candidate) => candidate.number === hole)) continue;
      const end = matches[index + 1]?.index ?? text.length;
      const metrics = metricsFromClause(text.slice((matches[index].index ?? 0) + matches[index][0].length, end));
      if (Object.keys(metrics).length) commands.push({ hole, metrics });
    }
  } else if (currentHole && course.holes.some((candidate) => candidate.number === currentHole)) {
    const metrics = metricsFromClause(text);
    if (Object.keys(metrics).length) commands.push({ hole: currentHole, metrics });
  }

  return commands;
}
