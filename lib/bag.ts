/** Club carry distances and the choice between them. Pure; the store lives in ./bag-store. */

export interface Club {
  id: string;
  label: string;
  /** Carry in yards. Carry, not total — roll is modelled separately when a shot is drawn. */
  carryYds: number;
}

export interface Bag {
  clubs: Club[];
}

export const MIN_CARRY_YDS = 30;
export const MAX_CARRY_YDS = 350;

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
    clubs.push({
      id: entry.id,
      label: entry.label,
      carryYds: Math.round(Math.min(MAX_CARRY_YDS, Math.max(MIN_CARRY_YDS, entry.carryYds))),
    });
  }
  if (clubs.length === 0) return DEFAULT_BAG;

  clubs.sort((left, right) => right.carryYds - left.carryYds);
  return { clubs };
}
