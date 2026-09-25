# Caddy Stack

A mobile-first, voice-friendly golf round tracker. Golfers, rounds, and course scorecards live in Supabase, with a local mirror so scoring keeps working when the course has no signal.

## Included

- Sign in with Google; every round is private to that verified account
- Select a saved course, tee, and front nine, back nine, or full round; no course is selected by default
- Prepare courses and their scorecards before heading out; look up additional tees when needed
- Preloaded official white-tee scorecard for Genesee Valley Golf Course — South, with North's white-tee card and hole map in the shared course catalogue
- Record until you tap stop, with pauses allowed while you think
- Update current or past holes with general requests, including several corrections at once
- Manual one-handed score entry and complete scorecard
- An "I'm lost" guide that walks you back to the next hole on your card after a wrong turn
- Correct a saved round's scores and the date it was played
- Log a finished round by photographing its paper scorecard, with a review step before it is saved
- Supabase-backed record of every game, synced across devices and kept separate per golfer
- Keeps scoring through dead zones and flushes to the database when signal returns
- Progress dashboard with scoring, best-round, and handicap-trend metrics
- Export the full round history to a CSV spreadsheet
- Responsive UI for phone and desktop browsers
- Checked-in Capacitor Android project that reuses the same UI and Vercel backend

## Local development

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Android

The Vercel site remains the primary web build. A separate Capacitor/Vite target bundles the same screens locally for Android and sends API requests to the existing Vercel backend.

```bash
npm run android:sync
npm run android:open
```

See [ANDROID.md](./ANDROID.md) for Android Studio setup, device testing, architecture, signing, and the future Google Play `.aab` workflow.

Course research, AI command interpretation, and cloud transcription use Vercel AI Gateway through the linked project's OIDC token. The Vercel team must have AI Gateway billing enabled. Browser speech recognition and the local command parser provide a fallback for scoring when available.

## Accounts and data ownership

Caddy Stack requires Google sign-in through Supabase Auth. Every protected API
request carries a short-lived access token. The server validates it with
Supabase and derives the golfer profile from the verified Auth user; it never
trusts a golfer ID supplied by the browser. AI endpoints are protected too, so
anonymous callers cannot spend the project's transcription or model budget.

The local mirror remains keyed by golfer for offline scoring. A queued write
only drains while its owning golfer is signed in, preventing data recorded for
one account from being replayed under another account's token. Account deletion
is available in the profile menu and at `/delete-account`; it removes the Auth
user, golfer profile, rounds, and matching local data.

See [AUTHENTICATION.md](./AUTHENTICATION.md) for the Supabase migration, Google
OAuth callback, Vercel variables, Android deep link, and release checks.

## Logging a paper scorecard

`Play` has a **Log a round from a photo** card that stays available whether or
not a round is in progress. The photo goes to `app/api/scorecard-photo/`, which
transcribes the card's holes, pars, yardages, stroke indexes, and every scored
column. `lib/scorecard-import.ts` then decides what actually gets stored, and it
does that without a model in the loop so the rules stay testable:

- A card naming a course the app already holds reuses that saved scorecard, so a
  photographed back nine keeps its real hole numbers and guidance.
- Any other card becomes its own course built from the pars and yardages printed
  on it. A standalone back nine is renumbered from one and named accordingly,
  because a segment is read by position within the course's holes.
- A card without a printed rating and slope falls back to its par and the USGA
  neutral slope of 113, which keeps the handicap estimate computable.
- A blank or unreadable box is reported, never invented. The round is saved and
  the scorecard editor opens on it so the gaps can be filled in by hand.

The card is transcribed, not interpreted: multi-player cards ask which column
belongs to the golfer, and nothing is written until the review is confirmed.

## Correcting a saved round

A new round is stamped with today's date, as it always was. The scorecard for a
saved round then lets that date be changed, for history entered after the fact.

A round carries a start and a finish, and the app files it under the finish, so
`lib/round-date.ts` shifts both by the same whole number of days rather than
stamping a new date on each. The time of day survives, a round that ran past
midnight still spans two days, and the shift is measured between local midnights
so it holds across a daylight saving change. Dates are handled in the golfer's
local time throughout — the day the app displays is the day it stores and
exports.

## Exporting the history

`Progress` has an **Export round history** button that downloads the selected
golfer's rounds as `caddy-stack-<golfer>-history-<date>.csv`, built in the
browser from the local mirror so it works without signal.

The file is one row per hole, with the round's date, course, tee, segment,
rating, and slope repeated on each row alongside that hole's par, yardage,
stroke index, gross and net score, and score to par, plus the round's totals and
its handicap. That is the shape a spreadsheet sorts, filters, and pivots without
reshaping, and it is the whole of what the app knows about how a round was
played. Handicap columns use the index estimated across the whole history, the
same one the progress page shows, so a later export restates them. In-progress
rounds are included with a `status` column and blank scores for holes not yet
played.

## Persistence

Supabase is the source of truth:

| Table | Holds |
| --- | --- |
| `golfers` | One row per verified account: `id`, display `name`, Auth owner, and optional legacy-claim email. |
| `courses` | One row per course and tee: rating, slope, par, total yardage, source URL, and the full per-hole scorecard (`holes` jsonb — par, yardage, handicap, club, strategy). |
| `games` | One row per game played: the `golfer_id` that owns it, course reference, segment, start and completion times, status, hole-by-hole `scores`, the voice/manual `events` log, and a `course_snapshot` of the scorecard as it was that day. |
| `course_geometry` | OpenStreetMap geometry for one physical course: hole centrelines, greens and hazards, cached so Overpass is called about once per course. |
| `course_geometry_links` | Which geometry row, and which hole in it, each scorecard hole belongs to, keyed on a tee-independent name and location. |
| `round_summaries` | The AI caddy's post-round take for one game, stored with a fingerprint of what it was written about. |

Courses and their geometry are a shared catalogue — a scorecard is the same whoever
plays it — while games and their summaries belong to exactly one golfer.

The browser never holds database credentials. `lib/storage.ts` talks to route
handlers under `app/api/`, and only those run queries, using the project's
secret key. Row level security is enabled on every table with no policies, so
the publishable key reads nothing.

`lib/storage.ts` writes every change to a local mirror first and queues an
idempotent upsert behind it. If the network is gone the round keeps going in
the browser; the queue drains on reconnect, on tab focus, and on a backoff
timer. Queued writes for the same game collapse into one, so a full nine is a
handful of requests rather than one per hole.

### Environment

Set these locally in `.env.local` and in the Vercel project (all environments):

```
SUPABASE_URL=https://jjalejuswitoysnxgvtc.supabase.co
SUPABASE_SECRET_KEY=<Supabase dashboard → Project Settings → API Keys → secret>
CRON_SECRET=<random string of at least 16 characters>
```

### Keeping the free Supabase project active

Vercel calls `/api/cron/keep-supabase-active` once per day from the production
deployment. The protected endpoint performs three minimal, read-only database
requests and does not change application data. This supplies the few daily user
database requests Supabase currently recommends for keeping a Free Plan project
out of its low-activity pause window.

Set `CRON_SECRET` in the Vercel project's Production environment before deploying.
Vercel automatically sends it as a bearer token to the scheduled endpoint. The
schedule is defined in `vercel.json` and runs at approximately 15:17 UTC; Vercel
Hobby schedules can run at any point during the selected hour.

Schema changes belong in Supabase migrations, not in application code.

## Course data

Genesee Valley South and North white-tee data comes from the [Monroe County Parks Golf scorecard](https://monroecountyparksgolf.com/wp-content/uploads/2023/02/Genesee-Valley-S-N-6x12_23-v6-02.14-proof.pdf). Newly researched courses keep their source URL alongside a browser-local course snapshot. Club suggestions are general distance-based guidance, not personalized recommendations.

### Hole geometry

Caddy View draws each hole from OpenStreetMap data, fetched through the Overpass API and
cached in `course_geometry`. That data is licensed [ODbL](https://opendatacommons.org/licenses/odbl/),
so every map carries the attribution "© OpenStreetMap contributors" — keep it wherever the
map is shown.

Geometry is deliberately separate from the scorecard. `courses.id` is `slugify(name + tee)`,
so one physical course has a row per set of tees, while a green sits in one place whatever
tee you played from; `course_geometry_links` keys on a normalised `name|location` instead.
Keeping the two apart also means `games.course_snapshot` never changes shape, so no saved
round is affected.

OSM hole ways start at the back tee, so their lengths run longer than a forward-tee
scorecard. **The scorecard stays the source of truth for tee-box yardage** — OSM supplies
the hole shape, the green, and the hazards, and every live number is measured from GPS.

Overpass is called at most once per physical course: the route checks the cache for the key,
then for any cached course within 2.5 km of the fix, before going out to the network. A
course OSM has not mapped is recorded as an empty row so it is never looked up again, and
greens can be captured by standing on them instead.

### Finding your hole

The hole card ends with a quiet **I'm lost** link, shown during a round on a mapped course. It
opens a full-screen guide to the next hole on the card: the first one without a score, which
is the right answer after playing the wrong hole whether or not that hole was scored. The
arrows beside the hole number pick a different one.

`lib/lost-guide.ts` does the measuring, and every line it shows is backed by the map:

- It aims for the tee on the scorecard, not the back tee OSM starts the hole from: that tee sits
  the card's yardage back from the green along the hole's line, capped at 120 m up from the tips.
- Anywhere between the back tee and that tee counts as having arrived. Once there, the fix has
  to wander 55 m away before the guide takes it back, so GPS wobble cannot flicker the screen.
- "You're by the 8th green" and "Hole 4 tees off by the 3rd green" are only said when one hole
  is plainly nearer than any other; between two fairways it says nothing.
- It warns when mapped water crosses the straight walk. It does not route around it, because
  only water is reliably mapped and a route that avoided it could steer through what is not.

The arrow comes from the phone's compass (`lib/compass.ts`): the absolute orientation event on
Android, `webkitCompassHeading` on iOS after asking from the tap that opened the guide. Without
a compass it follows the direction you are walking. The guide runs its own position watch and
compass, and Caddy View's watch is closed while it is open. On Android the back button closes
the guide before it does anything else.

## Round summaries

A completed round's page marks every score the way a paper card does: a circle for a
birdie, a double circle for an eagle, a square for a bogey, a double square for a double,
and a filled square beyond that. Beside the card it lists what went well and what cost
strokes. Those facts come from `lib/round-report.ts`, which never reports a stat that was
not tracked.

At the bottom, the AI caddy writes a short take comparing the round with the five before
it. It runs on Gemini through the Vercel AI Gateway, like the app's other AI features, and
is handed only the facts `round-report` computed, so it can joke about the numbers but not
invent them. Each take is stored in `round_summaries` against a fingerprint of the round's
scores, tracked stats, and the rounds it was compared with. Editing any of those writes a
fresh take rather than quoting numbers that are no longer true.

`CADDY_E2E=1 npx vitest run lib/round-summary.e2e.test.ts` runs the prompt against the real
model. It needs gateway credentials locally: `AI_GATEWAY_API_KEY`, or a current
`VERCEL_OIDC_TOKEN` from `vercel env pull`.
