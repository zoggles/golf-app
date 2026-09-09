begin;

alter table public.golfers
  add column if not exists auth_user_id uuid references auth.users(id) on delete cascade,
  add column if not exists login_email text;

create unique index if not exists golfers_auth_user_id_key
  on public.golfers (auth_user_id);

create unique index if not exists golfers_login_email_key
  on public.golfers (lower(login_email))
  where login_email is not null;

alter table public.golfers
  drop constraint if exists golfers_login_email_lowercase,
  add constraint golfers_login_email_lowercase
    check (login_email is null or login_email = lower(login_email));

alter table public.games
  drop constraint if exists games_golfer_id_fkey,
  add constraint games_golfer_id_fkey
    foreign key (golfer_id) references public.golfers(id) on delete cascade;

comment on column public.golfers.auth_user_id is
  'Verified Supabase Auth user that exclusively owns this golfer profile.';
comment on column public.golfers.login_email is
  'Lowercase administrator-set Google email used to claim a legacy profile on first sign-in.';

alter table public.golfers enable row level security;
alter table public.games enable row level security;
alter table public.courses enable row level security;

revoke all on table public.golfers from anon, authenticated;
revoke all on table public.games from anon, authenticated;
revoke all on table public.courses from anon, authenticated;

notify pgrst, 'reload schema';

-- Before a current golfer signs in for the first time, preserve their history
-- by assigning their verified lowercase Gmail address here in the SQL editor:
-- update public.golfers set login_email = 'golfer@gmail.com' where id = '<existing-golfer-id>';

commit;
