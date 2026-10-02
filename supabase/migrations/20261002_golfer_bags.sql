begin;

-- One bag per golfer: the clubs they carry, each club's carry distance, and the range shots
-- those carries came from. Stored as one document because it is always read and written
-- whole, and so a range session logged offline lands as a single write.
create table if not exists public.golfer_bags (
  golfer_id uuid primary key references public.golfers(id) on delete cascade,
  clubs jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint golfer_bags_clubs_is_array check (jsonb_typeof(clubs) = 'array')
);

comment on table public.golfer_bags is
  'The clubs a golfer carries and how far each one carries. Caddy View picks clubs from it.';
comment on column public.golfer_bags.clubs is
  'Array of Club: {id, label, carryYds, shots?: [{yds, at}]}. Shots are the most recent range shots per club, oldest first.';
comment on column public.golfer_bags.updated_at is
  'When the bag last changed on the device that wrote it. A write older than this is answered with the stored bag instead.';

-- Matches the other tables: RLS on with no policies, so only server routes holding the
-- secret key can read or write.
alter table public.golfer_bags enable row level security;
revoke all on table public.golfer_bags from anon, authenticated;

notify pgrst, 'reload schema';

commit;
