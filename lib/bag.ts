/** Club carry distances and the choice between them. Pure; the store lives in ./bag-store. */

export interface RangeShot {
  /** Carry in yards, judged against the range flags. */
  yds: number;
  /** ISO timestamp the shot was logged. Doubles as its identity within a club. */
  at: string;
}

export interface Club {
  id: string;
  label: string;
  /** Carry in yards. Carry, not total — roll is modelled separately when a shot is drawn. */
  carryYds: number;
  /** Range shots logged by an earlier build. Kept so nothing a golfer logged is thrown away. */
  shots?: RangeShot[];
}

export interface Bag {
  clubs: Club[];
  /** When the bag last changed on any device. Missing on bags saved before they synced. */
  updatedAt?: string;
}

export const MIN_CARRY_YDS = 30;
export const MAX_CARRY_YDS = 350;
/** Range shots can be shorter than any full carry: a chunked lob wedge still counts. */
const MIN_SHOT_YDS = 1;
const MAX_SHOT_YDS = 400;
/** Enough history for a steady median without the bag document growing without end. */
export const MAX_SHOTS_PER_CLUB = 40;
/** The Rules allow fourteen clubs and the putter is one of them. A warning, not a wall. */
export const MAX_CLUBS = 13;

/**
 * A mid-handicap starting set, so the first tap of Caddy View says something sensible
 * before anyone has edited anything. These are averages, not career-best numbers.
 */
export const DEFAULT_BAG: Bag = {
  clubs: [
    { id: "driver", label: "Driver", carryYds: 230 },
    { id: "3w", label: "3 wood", carryYds: 205 },
    { id: "5w", label: "5 wood", carryYds: 190 },
    { id: "4h", label: "4 hybrid", carryYds: 180 },
    { id: "5i", label: "5 iron", carryYds: 165 },
    { id: "6i", label: "6 iron", carryYds: 155 },
    { id: "7i", label: "7 iron", carryYds: 145 },
    { id: "8i", label: "8 iron", carryYds: 133 },
    { id: "9i", label: "9 iron", carryYds: 120 },
    { id: "pw", label: "Pitching wedge", carryYds: 105 },
    { id: "gw", label: "Gap wedge", carryYds: 90 },
    { id: "sw", label: "Sand wedge", carryYds: 75 },
    { id: "lw", label: "Lob wedge", carryYds: 60 },
  ],
};

export type ClubKind = "wood" | "hybrid" | "iron" | "wedge";

export interface CatalogClub {
  id: string;
  label: string;
  /** What is stamped on the sole, more or less. Fits a chip. */
  short: string;
  kind: ClubKind;
  /** Typical loft. Orders the bag the way it sits in a golfer's head, not by this week's carry. */
  loft: number;
  /** The same mid-handicap scale as DEFAULT_BAG. */
  carryYds: number;
}

/** Every club the bag can hold. Ids match DEFAULT_BAG so older saved bags still resolve. */
export const CLUB_CATALOG: CatalogClub[] = [
  { id: "driver", label: "Driver", short: "DR", kind: "wood", loft: 10.5, carryYds: 230 },
  { id: "3w", label: "3 wood", short: "3W", kind: "wood", loft: 15, carryYds: 205 },
  { id: "4w", label: "4 wood", short: "4W", kind: "wood", loft: 16.5, carryYds: 198 },
  { id: "5w", label: "5 wood", short: "5W", kind: "wood", loft: 18, carryYds: 190 },
  { id: "7w", label: "7 wood", short: "7W", kind: "wood", loft: 21, carryYds: 180 },
  { id: "2h", label: "2 hybrid", short: "2H", kind: "hybrid", loft: 17, carryYds: 195 },
  { id: "3h", label: "3 hybrid", short: "3H", kind: "hybrid", loft: 19.5, carryYds: 188 },
  { id: "4h", label: "4 hybrid", short: "4H", kind: "hybrid", loft: 22, carryYds: 180 },
  { id: "5h", label: "5 hybrid", short: "5H", kind: "hybrid", loft: 25, carryYds: 170 },
  { id: "6h", label: "6 hybrid", short: "6H", kind: "hybrid", loft: 28, carryYds: 160 },
  { id: "2i", label: "2 iron", short: "2i", kind: "iron", loft: 18, carryYds: 190 },
  { id: "3i", label: "3 iron", short: "3i", kind: "iron", loft: 20.5, carryYds: 182 },
  { id: "4i", label: "4 iron", short: "4i", kind: "iron", loft: 23, carryYds: 174 },
  { id: "5i", label: "5 iron", short: "5i", kind: "iron", loft: 26, carryYds: 165 },
  { id: "6i", label: "6 iron", short: "6i", kind: "iron", loft: 29, carryYds: 155 },
  { id: "7i", label: "7 iron", short: "7i", kind: "iron", loft: 33, carryYds: 145 },
  { id: "8i", label: "8 iron", short: "8i", kind: "iron", loft: 37, carryYds: 133 },
  { id: "9i", label: "9 iron", short: "9i", kind: "iron", loft: 41, carryYds: 120 },
  { id: "pw", label: "Pitching wedge", short: "PW", kind: "wedge", loft: 45, carryYds: 105 },
  { id: "gw", label: "Gap wedge", short: "GW", kind: "wedge", loft: 50, carryYds: 90 },
  { id: "sw", label: "Sand wedge", short: "SW", kind: "wedge", loft: 55, carryYds: 75 },
  { id: "lw", label: "Lob wedge", short: "LW", kind: "wedge", loft: 59, carryYds: 60 },
];

const CATALOG_BY_ID = new Map(CLUB_CATALOG.map((entry) => [entry.id, entry]));

export function catalogClub(id: string): CatalogClub | null {
  return CATALOG_BY_ID.get(id) ?? null;
}

/** Chip text for a club, including any that predate the catalog. */
export function clubShort(club: Club): string {
  return catalogClub(club.id)?.short ?? club.label.slice(0, 2).toUpperCase();
}

export function clubKind(club: Club): ClubKind {
  return catalogClub(club.id)?.kind ?? "iron";
}

/**
 * Clubs by loft, strongest first. Carry order would shuffle the list every time a number is
 * nudged past its neighbour; loft order holds still and makes a crossed pair stand out.
 */
export function clubsByLoft(bag: Bag): Club[] {
  const loftOf = (club: Club) => catalogClub(club.id)?.loft ?? 60 - club.carryYds / 5;
  return [...bag.clubs].sort((left, right) => loftOf(left) - loftOf(right) || right.carryYds - left.carryYds);
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * What this golfer's swing does to the catalog's numbers, as one multiplier. A median of the
 * ratios, so one club set to a hopeful number does not drag every new club along with it.
 */
function bagScale(bag: Bag): number {
  const ratios = bag.clubs
    .map((club) => {
      const entry = catalogClub(club.id);
      return entry ? club.carryYds / entry.carryYds : null;
    })
    .filter((ratio): ratio is number => ratio !== null);
  return ratios.length ? median(ratios) : 1;
}

function clampCarry(yds: number): number {
  return Math.round(Math.min(MAX_CARRY_YDS, Math.max(MIN_CARRY_YDS, yds)));
}

/** A starting carry for a club joining this bag, scaled to how far the rest of it goes. */
export function suggestCarry(bag: Bag, entry: CatalogClub): number {
  return clampCarry(entry.carryYds * bagScale(bag));
}

export function addClub(bag: Bag, clubId: string): Bag {
  const entry = catalogClub(clubId);
  if (!entry || bag.clubs.some((club) => club.id === clubId)) return bag;
  return { ...bag, clubs: [...bag.clubs, { id: entry.id, label: entry.label, carryYds: suggestCarry(bag, entry) }] };
}

/** Never empties the bag: the caddy needs at least one number to reason with. */
export function removeClub(bag: Bag, clubId: string): Bag {
  if (bag.clubs.length <= 1) return bag;
  return { ...bag, clubs: bag.clubs.filter((club) => club.id !== clubId) };
}

function updateClub(bag: Bag, clubId: string, change: (club: Club) => Club): Bag {
  return { ...bag, clubs: bag.clubs.map((club) => (club.id === clubId ? change(club) : club)) };
}

export function setCarry(bag: Bag, clubId: string, carryYds: number): Bag {
  return updateClub(bag, clubId, (club) => ({ ...club, carryYds: clampCarry(carryYds) }));
}

export type GapTone = "even" | "wide" | "tight";

export interface ClubGap {
  upper: Club;
  lower: Club;
  /** Carry of the stronger club minus the weaker. Negative when they have crossed. */
  yds: number;
  tone: GapTone;
}

/**
 * Past twenty-five yards there is a full approach distance with no club for it. Under five,
 * two clubs are doing one job, and below zero the weaker one goes further. The step down from
 * driver is never called wide: nobody hits a full approach between driver and fairway wood.
 */
const WIDE_GAP_YDS = 25;
const TIGHT_GAP_YDS = 5;

export function bagGaps(bag: Bag): ClubGap[] {
  const ordered = clubsByLoft(bag);
  return ordered.slice(1).map((lower, index) => {
    const upper = ordered[index];
    const yds = upper.carryYds - lower.carryYds;
    const wide = yds > WIDE_GAP_YDS && upper.id !== "driver";
    const tone: GapTone = wide ? "wide" : yds < TIGHT_GAP_YDS ? "tight" : "even";
    return { upper, lower, yds, tone };
  });
}

export interface ClubPick {
  club: Club;
  /** Carry minus the distance asked for. Negative means the club comes up short. */
  deltaYds: number;
  /** False when nothing in the bag reaches, so the UI can stop claiming a number. */
  confident: boolean;
  alternative: Club | null;
}

export function longestCarry(bag: Bag): number {
  return bag.clubs.reduce((longest, club) => Math.max(longest, club.carryYds), 0);
}

export function shortestCarry(bag: Bag): number {
  return bag.clubs.reduce((shortest, club) => Math.min(shortest, club.carryYds), Infinity);
}

/**
 * Nearest carry to the distance asked for, with a small bias toward the longer club.
 * Amateurs miss short far more often than long, and a green is nearly always guarded at
 * the front, so a tie goes up.
 */
const LONG_BIAS_YDS = 3;

export function pickClub(bag: Bag, distanceYds: number): ClubPick | null {
  if (bag.clubs.length === 0) return null;

  const ranked = [...bag.clubs].sort((left, right) => {
    const leftCost = Math.abs(left.carryYds - distanceYds) - (left.carryYds >= distanceYds ? LONG_BIAS_YDS : 0);
    const rightCost = Math.abs(right.carryYds - distanceYds) - (right.carryYds >= distanceYds ? LONG_BIAS_YDS : 0);
    if (leftCost !== rightCost) return leftCost - rightCost;
    return right.carryYds - left.carryYds;
  });

  const club = ranked[0];
  return {
    club,
    deltaYds: Math.round(club.carryYds - distanceYds),
    confident: distanceYds <= longestCarry(bag),
    alternative: ranked[1] ?? null,
  };
}

/** The club that gets you furthest without going past a limit, for laying up. */
export function longestClubWithin(bag: Bag, limitYds: number): Club | null {
  const within = bag.clubs.filter((club) => club.carryYds <= limitYds);
  if (within.length === 0) return null;
  return within.reduce((longest, club) => (club.carryYds > longest.carryYds ? club : longest));
}

/** The next club down from the one given, or null at the bottom of the bag. */
export function stepDown(bag: Bag, from: Club): Club | null {
  const shorter = bag.clubs.filter((club) => club.carryYds < from.carryYds);
  if (shorter.length === 0) return null;
  return shorter.reduce((longest, club) => (club.carryYds > longest.carryYds ? club : longest));
}

function isClubShape(value: unknown): value is Club {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Club>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.label === "string" &&
    candidate.label.length > 0 &&
    typeof candidate.carryYds === "number" &&
    Number.isFinite(candidate.carryYds)
  );
}

function normalizeShots(input: unknown): RangeShot[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const shots: RangeShot[] = [];
  for (const entry of input) {
    const candidate = entry as Partial<RangeShot> | null;
    if (typeof candidate?.yds !== "number" || !Number.isFinite(candidate.yds)) continue;
    if (typeof candidate.at !== "string" || Number.isNaN(Date.parse(candidate.at)) || seen.has(candidate.at)) continue;
    seen.add(candidate.at);
    shots.push({ yds: Math.round(Math.min(MAX_SHOT_YDS, Math.max(MIN_SHOT_YDS, candidate.yds))), at: candidate.at });
  }
  shots.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  return shots.slice(-MAX_SHOTS_PER_CLUB);
}

/** ISO in one spelling, so the database's "+00:00" and the browser's "Z" compare equal. */
function normalizeStamp(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const time = Date.parse(input);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

/**
 * Accepts whatever was in storage and returns something safe to reason about. A corrupt
 * or empty bag falls back to the default rather than leaving the caddy with nothing.
 */
export function normalizeBag(input: unknown): Bag {
  const raw = (input as Partial<Bag> | null)?.clubs;
  if (!Array.isArray(raw)) return DEFAULT_BAG;

  const seen = new Set<string>();
  const clubs: Club[] = [];
  for (const entry of raw) {
    if (!isClubShape(entry) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    const shots = normalizeShots(entry.shots);
    clubs.push({
      id: entry.id,
      label: entry.label,
      carryYds: clampCarry(entry.carryYds),
      ...(shots.length ? { shots } : {}),
    });
  }
  if (clubs.length === 0) return DEFAULT_BAG;

  clubs.sort((left, right) => right.carryYds - left.carryYds);
  const updatedAt = normalizeStamp((input as Partial<Bag>).updatedAt);
  return updatedAt ? { clubs, updatedAt } : { clubs };
}

/** True when the first bag changed after the second. A bag with no stamp is the oldest. */
export function isNewerBag(candidate: Bag, than: Bag | null): boolean {
  const candidateTime = candidate.updatedAt ? Date.parse(candidate.updatedAt) : -Infinity;
  const thanTime = than?.updatedAt ? Date.parse(than.updatedAt) : -Infinity;
  return candidateTime > thanTime;
}
