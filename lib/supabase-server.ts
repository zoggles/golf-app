import type { Golfer } from "./golfers";
import type { Course, GolfData, GolfRound, Hole, RoundEvent, RoundSegment, RoundStatus } from "./types";

/**
 * Server-only Supabase access.
 *
 * The browser never touches the database. These helpers run inside route
 * handlers with the project's secret key, which bypasses row level security.
 * Both tables have RLS enabled with no policies, so a leaked publishable key
 * still reads nothing.
 */

const RAW_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export class SupabaseConfigError extends Error {
  constructor() {
    super("Supabase is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY.");
    this.name = "SupabaseConfigError";
  }
}

export class SupabaseRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "SupabaseRequestError";
    this.status = status;
  }
}

export function isSupabaseConfigured(): boolean {
  return Boolean(RAW_URL && SECRET_KEY);
}

function endpoint(path: string): string {
  if (!isSupabaseConfigured()) throw new SupabaseConfigError();
  return `${RAW_URL.replace(/\/+$/, "")}/rest/v1/${path}`;
}

async function rest<T>(path: string, init: RequestInit & { prefer?: string }): Promise<T> {
  const { prefer, headers, ...options } = init;
  const response = await fetch(endpoint(path), {
    ...options,
    cache: "no-store",
    headers: {
      apikey: SECRET_KEY,
      Authorization: `Bearer ${SECRET_KEY}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
      ...headers,
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new SupabaseRequestError(response.status, detail || response.statusText);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

interface CourseRow {
  id: string;
  name: string;
  short_name: string;
  location: string;
  tee: string;
  rating: number | string;
  slope: number;
  par: number;
  yards: number;
  source_url: string;
  holes: unknown;
}

interface GolferRow {
  id: string;
  name: string;
  auth_user_id?: string | null;
  login_email?: string | null;
}

interface GameRow {
  id: string;
  golfer_id: string;
  course_id: string;
  course_name: string;
  location: string;
  segment: RoundSegment;
  tee: string;
  course_rating: number | string;
  course_slope: number;
  course_snapshot: unknown;
  started_at: string;
  completed_at: string | null;
  status: RoundStatus;
  scores: unknown;
  events: unknown;
}

function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

function courseFromRow(row: CourseRow): Course {
  return {
    id: row.id,
    name: row.name,
    shortName: row.short_name,
    location: row.location,
    tee: row.tee,
    rating: toNumber(row.rating),
    slope: row.slope,
    par: row.par,
    yards: row.yards,
    sourceUrl: row.source_url,
    holes: (row.holes ?? []) as Hole[],
  };
}

function courseToRow(course: Course): CourseRow {
  return {
    id: course.id,
    name: course.name,
    short_name: course.shortName,
    location: course.location,
    tee: course.tee,
    rating: course.rating,
    slope: course.slope,
    par: course.par,
    yards: course.yards,
    source_url: course.sourceUrl,
    holes: course.holes,
  };
}

function gameFromRow(row: GameRow): GolfRound {
  const course = row.course_snapshot as Course;
  return {
    id: row.id,
    courseId: row.course_id,
    courseName: row.course_name,
    location: row.location,
    segment: row.segment,
    tee: row.tee,
    courseRating: toNumber(row.course_rating),
    courseSlope: row.course_slope,
    course,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    status: row.status,
    scores: (row.scores ?? {}) as Record<number, number>,
    events: (row.events ?? []) as RoundEvent[],
  };
}

/**
 * The owner comes from the resolved golfer, never from the round the browser
 * sent, so a request cannot write into someone else's history.
 */
function gameToRow(round: GolfRound, golferId: string): GameRow {
  return {
    id: round.id,
    golfer_id: golferId,
    course_id: round.courseId,
    course_name: round.courseName,
    location: round.location,
    segment: round.segment,
    tee: round.tee,
    course_rating: round.courseRating,
    course_slope: round.courseSlope,
    course_snapshot: round.course,
    started_at: round.startedAt,
    completed_at: round.completedAt ?? null,
    status: round.status,
    scores: round.scores,
    events: round.events,
  };
}

export async function saveCourseRow(course: Course): Promise<Course> {
  const rows = await rest<CourseRow[]>("courses?on_conflict=id", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=representation",
    body: JSON.stringify(courseToRow(course)),
  });
  const row = rows[0];
  if (!row) throw new SupabaseRequestError(500, "Course upsert returned no row.");
  return courseFromRow(row);
}

export async function saveGameRow(round: GolfRound, golferId: string): Promise<GolfRound> {
  // The course row is written first so the game's foreign key always resolves,
  // whatever order the client's offline queue drains in.
  if (round.course) await saveCourseRow(round.course);
  const rows = await rest<GameRow[]>("games?on_conflict=id", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=representation",
    body: JSON.stringify(gameToRow(round, golferId)),
  });
  const row = rows[0];
  if (!row) throw new SupabaseRequestError(500, "Game upsert returned no row.");
  return gameFromRow(row);
}

export async function deleteGameRow(gameId: string, golferId: string): Promise<void> {
  await rest<undefined>(
    `games?id=eq.${encodeURIComponent(gameId)}&golfer_id=eq.${encodeURIComponent(golferId)}`,
    { method: "DELETE", prefer: "return=minimal" },
  );
}

/** Courses are a shared catalogue; games belong to one golfer. */
export async function readGolfDataFromDb(golferId: string): Promise<GolfData> {
  const [gameRows, courseRows] = await Promise.all([
    rest<GameRow[]>(
      `games?select=*&golfer_id=eq.${encodeURIComponent(golferId)}&order=started_at.desc`,
      { method: "GET" },
    ),
    rest<CourseRow[]>("courses?select=*&order=created_at.desc", { method: "GET" }),
  ]);

  const rounds = gameRows.map(gameFromRow);
  return {
    version: 2,
    activeRoundId: rounds.find((round) => round.status === "active")?.id ?? null,
    rounds,
    courses: courseRows.map(courseFromRow),
  };
}

function golferFromRow(row: GolferRow): Golfer {
  return { id: row.id, name: row.name };
}

function accountName(email: string, metadata?: Record<string, unknown>): string {
  const supplied = [metadata?.full_name, metadata?.name].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  return (supplied?.trim() || email.split("@")[0] || "Golfer").slice(0, 60);
}

/**
 * One verified Supabase user owns one golfer row. An administrator can attach
 * an existing history by putting that user's lowercase Gmail address in
 * login_email before their first sign-in; otherwise a fresh profile is made.
 */
export async function ensureGolferRow(user: {
  id: string;
  email: string;
  user_metadata?: Record<string, unknown>;
}): Promise<Golfer> {
  const owned = await rest<GolferRow[]>(
    `golfers?auth_user_id=eq.${encodeURIComponent(user.id)}&select=id,name&limit=1`,
    { method: "GET" },
  );
  if (owned[0]) return golferFromRow(owned[0]);

  const email = user.email.trim().toLowerCase();
  const legacy = await rest<GolferRow[]>(
    `golfers?login_email=eq.${encodeURIComponent(email)}&auth_user_id=is.null&select=id,name&limit=1`,
    { method: "GET" },
  );
  if (legacy[0]) {
    const claimed = await rest<GolferRow[]>(
      `golfers?id=eq.${encodeURIComponent(legacy[0].id)}&auth_user_id=is.null&select=id,name`,
      {
        method: "PATCH",
        prefer: "return=representation",
        body: JSON.stringify({ auth_user_id: user.id }),
      },
    );
    if (claimed[0]) return golferFromRow(claimed[0]);
  }

  const created = await rest<GolferRow[]>("golfers?on_conflict=auth_user_id&select=id,name", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=representation",
    body: JSON.stringify({
      name: accountName(email, user.user_metadata),
      auth_user_id: user.id,
      login_email: email,
    }),
  });
  const row = created[0];
  if (!row) throw new SupabaseRequestError(500, "Account provisioning returned no golfer.");
  return golferFromRow(row);
}

function authEndpoint(path: string): string {
  if (!isSupabaseConfigured()) throw new SupabaseConfigError();
  return `${RAW_URL.replace(/\/+$/, "")}/auth/v1/${path}`;
}

/**
 * Provisions the Supabase Auth account behind a name-and-PIN login. The account
 * is confirmed on creation because there is no address to confirm. Reports an
 * existing name rather than throwing, so the caller can ask for the PIN again
 * without revealing whether the name or the PIN was wrong.
 */
export async function createPinAccountUser(
  email: string,
  pin: string,
  name: string,
): Promise<"created" | "exists"> {
  const response = await fetch(authEndpoint("admin/users"), {
    method: "POST",
    cache: "no-store",
    headers: {
      apikey: SECRET_KEY,
      Authorization: `Bearer ${SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      password: pin,
      email_confirm: true,
      user_metadata: { full_name: name, pin_login: true },
    }),
  });
  if (response.ok) return "created";
  const detail = await response.text();
  if (/already been registered|already exists|email_exists/i.test(detail)) return "exists";
  throw new SupabaseRequestError(response.status, detail || response.statusText);
}

export async function listGolferRows(): Promise<Golfer[]> {
  const rows = await rest<GolferRow[]>("golfers?select=id,name&order=created_at.asc", { method: "GET" });
  return rows.map(golferFromRow);
}

export async function createGolferRow(name: string): Promise<Golfer> {
  const rows = await rest<GolferRow[]>("golfers?select=id,name", {
    method: "POST",
    prefer: "return=representation",
    body: JSON.stringify({ name }),
  });
  const row = rows[0];
  if (!row) throw new SupabaseRequestError(500, "Golfer insert returned no row.");
  return golferFromRow(row);
}

export async function renameGolferRow(golferId: string, name: string): Promise<Golfer> {
  const rows = await rest<GolferRow[]>(`golfers?id=eq.${encodeURIComponent(golferId)}&select=id,name`, {
    method: "PATCH",
    prefer: "return=representation",
    body: JSON.stringify({ name }),
  });
  const row = rows[0];
  if (!row) throw new SupabaseRequestError(404, "That golfer no longer exists.");
  return golferFromRow(row);
}
