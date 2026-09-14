begin;

-- One post-round summary per game, written by the AI caddy on the round page.
-- Stored rather than regenerated on every view, so the same round reads the same on the
-- phone and the website, and a model call is only paid for once per version of the round.
create table if not exists public.round_summaries (
  game_id text primary key references public.games(id) on delete cascade,
  golfer_id uuid not null references public.golfers(id) on delete cascade,
  fingerprint text not null,
  summary jsonb not null,
  model text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint round_summaries_summary_is_object check (jsonb_typeof(summary) = 'object'),
  constraint round_summaries_fingerprint_shape check (fingerprint ~ '^[0-9a-f]{8}$')
);

create index if not exists round_summaries_golfer_idx
  on public.round_summaries (golfer_id);

comment on table public.round_summaries is
  'AI-written post-round summary for one game: headline, what is improving, what to work on, and a sign-off.';
comment on column public.round_summaries.fingerprint is
  'Hash of the round''s scores, tracked stats and the earlier rounds it was compared with. A mismatch means the summary is stale and is written again.';

-- Matches the other tables: RLS on with no policies, so only server routes holding the
-- secret key can read or write.
alter table public.round_summaries enable row level security;
revoke all on table public.round_summaries from anon, authenticated;

notify pgrst, 'reload schema';

commit;
