# Fairway Log

A mobile-first, voice-friendly golf round tracker. Rounds and course scorecards live in Supabase, with a local mirror so scoring keeps working when the course has no signal.

## Included

- Start a front nine, back nine, or full round by voice or text
- Research an unknown course on demand and turn its published scorecard into app data
- Preloaded official white-tee scorecard for Genesee Valley Golf Course — South
- Record until you tap stop, with pauses allowed while you think
- Update current or past holes with general requests, including several corrections at once
- Manual one-handed score entry and complete scorecard
- Supabase-backed record of every game, synced across devices
- Keeps scoring through dead zones and flushes to the database when signal returns
- Progress dashboard with scoring, best-round, and handicap-trend metrics
- Responsive UI for phone and desktop browsers

## Local development

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

Course research, AI command interpretation, and cloud transcription use Vercel AI Gateway through the linked project's OIDC token. The Vercel team must have AI Gateway billing enabled. Browser speech recognition and the local command parser provide a fallback for scoring when available.

## Persistence

Supabase is the source of truth. Two tables hold everything:

| Table | Holds |
| --- | --- |
| `courses` | One row per course and tee: rating, slope, par, total yardage, source URL, and the full per-hole scorecard (`holes` jsonb — par, yardage, handicap, club, strategy). |
| `games` | One row per game played: course reference, segment, start and completion times, status, hole-by-hole `scores`, the voice/manual `events` log, and a `course_snapshot` of the scorecard as it was that day. |

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
