# Fairway Log

A mobile-first, voice-friendly golf round tracker. The first release stores rounds on-device in the browser and is structured so Supabase can replace that storage layer in a later phase.

## Included

- Start a front nine, back nine, or full round by voice or text
- Research an unknown course on demand and turn its published scorecard into app data
- Preloaded official white-tee scorecard for Genesee Valley Golf Course — South
- Record until you tap stop, with pauses allowed while you think
- Update current or past holes with general requests, including several corrections at once
- Manual one-handed score entry and complete scorecard
- Persistent browser storage for active and completed rounds
- Progress dashboard with scoring, best-round, and handicap-trend metrics
- Responsive UI for phone and desktop browsers

## Local development

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

Course research, AI command interpretation, and cloud transcription use Vercel AI Gateway through the linked project's OIDC token. The Vercel team must have AI Gateway billing enabled. Browser speech recognition and the local command parser provide a fallback for scoring when available.

## Persistence roadmap

`lib/storage.ts` is the current data adapter. A later Supabase phase can preserve the UI and types while replacing its read/write functions with authenticated database calls and cross-device sync.

## Course data

Genesee Valley South white-tee data comes from the [Monroe County Parks Golf scorecard](https://monroecountyparksgolf.com/wp-content/uploads/2023/02/Genesee-Valley-S-N-6x12_23-v6-02.14-proof.pdf). Newly researched courses keep their source URL alongside a browser-local course snapshot. Club suggestions are general distance-based guidance, not personalized recommendations.
