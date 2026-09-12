/**
 * Location handling for course names typed, spoken, or written by a model.
 *
 * The same place arrives in several spellings — "Rochester, NY" and "Rochester, New York"
 * are both in the catalogue for one course — so everything that compares locations has to
 * go through one normaliser, or a course quietly becomes two.
 */

const STATES: Record<string, string> = {
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california",
  co: "colorado", ct: "connecticut", de: "delaware", fl: "florida", ga: "georgia",
  hi: "hawaii", id: "idaho", il: "illinois", in: "indiana", ia: "iowa",
  ks: "kansas", ky: "kentucky", la: "louisiana", me: "maine", md: "maryland",
  ma: "massachusetts", mi: "michigan", mn: "minnesota", ms: "mississippi", mo: "missouri",
  mt: "montana", ne: "nebraska", nv: "nevada", nh: "new hampshire", nj: "new jersey",
  nm: "new mexico", ny: "new york", nc: "north carolina", nd: "north dakota", oh: "ohio",
  ok: "oklahoma", or: "oregon", pa: "pennsylvania", ri: "rhode island", sc: "south carolina",
  sd: "south dakota", tn: "tennessee", tx: "texas", ut: "utah", vt: "vermont",
  va: "virginia", wa: "washington", wv: "west virginia", wi: "wisconsin", wy: "wyoming",
  dc: "district of columbia",
  ab: "alberta", bc: "british columbia", mb: "manitoba", nb: "new brunswick",
  ns: "nova scotia", on: "ontario", qc: "quebec", sk: "saskatchewan",
};

/** Longest first, so "new york" is consumed before "new" or "york" can match alone. */
const STATE_NAMES = Object.values(STATES).sort((left, right) => right.length - left.length);

function basicNormalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * A comparable form of a place. State abbreviations expand to full names, so
 * "Rochester, NY" and "Rochester, New York" come out identical.
 */
export function normalizeLocation(value: string): string {
  return basicNormalize(value)
    .split(" ")
    .filter(Boolean)
    .map((word) => STATES[word] ?? word)
    .join(" ");
}

/** The distinct words of a place, with multi-word state names kept whole. */
export function locationTokens(value: string): string[] {
  let remaining = ` ${normalizeLocation(value)} `;
  const tokens: string[] = [];

  for (const state of STATE_NAMES) {
    if (state.includes(" ") && remaining.includes(` ${state} `)) {
      tokens.push(state);
      remaining = remaining.replace(` ${state} `, " ");
    }
  }
  for (const word of remaining.split(" ").filter(Boolean)) tokens.push(word);
  return [...new Set(tokens)];
}

/** Words that say something about the round rather than about where it is played. */
const ROUND_WORDS = new Set([
  "front", "back", "nine", "eighteen", "holes", "hole", "round", "play", "playing",
  "played", "today", "tomorrow", "morning", "afternoon", "let", "lets", "start",
  "starting", "score", "scoring", "tee", "tees", "teeing", "from", "off", "using",
  "the", "at", "in", "on", "of", "a", "an", "and", "my", "me", "i", "we", "with",
  "golf", "course", "club", "country", "links", "for", "to", "is", "it", "this",
  "forward", "red", "gold", "yellow", "white", "blue", "black", "green", "silver",
  "orange", "ivory", "championship", "senior", "seniors", "mens", "womens", "ladies",
]);

const isPlaceCandidate = (word: string) => word.length >= 2 && !ROUND_WORDS.has(word) && !/^\d+$/.test(word);

/**
 * Whether a phrase names somewhere other than where this course is.
 *
 * Naming a place is how you say "not that one". Without this, a saved Arrowhead in
 * Littleton CO answers to "Arrowhead Golf Course and Marina, Spencerport NY", because the
 * only distinguishing word in either name is "arrowhead".
 *
 * Saying nothing about location is not a contradiction — a bare course name still matches
 * whatever is saved.
 */
export function phraseContradictsLocation(
  courseName: string,
  courseLocation: string,
  phrase: string,
): boolean {
  const phraseTokens = locationTokens(phrase);
  const phraseText = ` ${normalizeLocation(phrase)} `;

  // Naming any part of where the course actually is settles it.
  for (const token of locationTokens(courseLocation)) {
    if (token.length >= 2 && phraseText.includes(` ${token} `)) return false;
  }

  const nameWords = new Set(basicNormalize(courseName).split(" ").filter(Boolean));
  return phraseTokens.some((token) => isPlaceCandidate(token) && !nameWords.has(token));
}
