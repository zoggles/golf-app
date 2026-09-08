# Caddy Stack

A mobile-first, voice-friendly golf round tracker. Golfers, rounds, and course scorecards live in Supabase, with a local mirror so scoring keeps working when the course has no signal.

## Included

- Pick which golfer is playing; every round is recorded against them
- Start a front nine, back nine, or full round by voice or text
- Research an unknown course on demand and turn its published scorecard into app data
- Preloaded official white-tee scorecard for Genesee Valley Golf Course — South
- Record until you tap stop, with pauses allowed while you think
- Update current or past holes with general requests, including several corrections at once
- Manual one-handed score entry and complete scorecard
- Correct a saved round's scores and the date it was played
- Log a finished round by photographing its paper scorecard, with a review step before it is saved
- Supabase-backed record of every game, synced across devices and kept separate per golfer
- Keeps scoring through dead zones and flushes to the database when signal returns
- Progress dashboard with scoring, best-round, and handicap-trend metrics
- Export the full round history to a CSV spreadsheet
- Responsive UI for phone and desktop browsers

## Local development

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

Course research, AI command interpretation, and cloud transcription use Vercel AI Gateway through the linked project's OIDC token. The Vercel team must have AI Gateway billing enabled. Browser speech recognition and the local command parser provide a fallback for scoring when available.

## Golfers, and where authentication will go

There is no sign-in yet. The app asks who is playing, remembers that choice in
the browser, and records every round against them. Switching golfers swaps the
whole view, and each golfer's rounds are invisible to the others.

The point of interest is `lib/golfers.ts`. Every request that reads or writes
rounds names its golfer in an `x-golfer-id` header, and `resolveGolferId` is the
only thing that reads it:

- Routes never take an owner from a request body. `saveGameRow` stamps
  `golfer_id` from the resolved golfer, so a crafted payload cannot write into
  someone else's history, and a database trigger refuses to move an existing
  game to a different golfer.
- Reads are filtered the same way, so a query cannot widen past its caller.
- A missing or malformed golfer is refused rather than silently scoped to
  nothing.

Adding accounts therefore means verifying a session inside `resolveGolferId` and
ignoring the header. No route, query, or table below it changes, and
`golfers.auth_user_id` is where a row would link to an authenticated account.

On the browser side, `lib/golfer-session.ts` is the matching seam: it owns the
selection and the headers to send, and is what a real session client replaces.
The local mirror is keyed per golfer so a switch is instant and works offline,
while the write queue is shared and stamps each pending write with the golfer it
belongs to — a round logged in a dead zone still drains to the right history
even if someone else picks up the phone first.

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

Supabase is the source of truth. Two tables hold everything:

| Table | Holds |
| --- | --- |
| `golfers` | One row per person using the app: `id` and `name`. |
| `courses` | One row per course and tee: rating, slope, par, total yardage, source URL, and the full per-hole scorecard (`holes` jsonb — par, yardage, handicap, club, strategy). |
| `games` | One row per game played: the `golfer_id` that owns it, course reference, segment, start and completion times, status, hole-by-hole `scores`, the voice/manual `events` log, and a `course_snapshot` of the scorecard as it was that day. |

Courses are a shared catalogue — a scorecard is the same whoever plays it — while
games belong to exactly one golfer.

The browser never holds database credentials. `lib/storage.ts` talks to route
handlers under `app/api/`, and only those run queries, using the project's
secret key. Row level security is enabled on both tables with no policies, so
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
```

Schema changes belong in Supabase migrations, not in application code.

## Course data

Genesee Valley South white-tee data comes from the [Monroe County Parks Golf scorecard](https://monroecountyparksgolf.com/wp-content/uploads/2023/02/Genesee-Valley-S-N-6x12_23-v6-02.14-proof.pdf). Newly researched courses keep their source URL alongside a browser-local course snapshot. Club suggestions are general distance-based guidance, not personalized recommendations.
