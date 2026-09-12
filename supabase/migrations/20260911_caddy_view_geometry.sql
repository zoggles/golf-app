begin;

-- Cached GPS geometry for a physical golf course, sourced from OpenStreetMap (ODbL).
-- Kept apart from public.courses on purpose: courses.id is slugify(name + tee), so one
-- physical course has a row per tee, while a green has one location regardless of tee.
create table if not exists public.course_geometry (
  id text primary key,
  name text not null default '',
  centre_lat double precision not null,
  centre_lng double precision not null,
  holes jsonb not null default '[]'::jsonb,
  hazards jsonb not null default '[]'::jsonb,
  source text not null default 'osm',
  attribution text not null default '© OpenStreetMap contributors',
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint course_geometry_source_known check (source in ('osm', 'manual')),
  constraint course_geometry_holes_is_array check (jsonb_typeof(holes) = 'array'),
  constraint course_geometry_hazards_is_array check (jsonb_typeof(hazards) = 'array'),
  constraint course_geometry_lat_range check (centre_lat between -90 and 90),
  constraint course_geometry_lng_range check (centre_lng between -180 and 180)
);

create index if not exists course_geometry_centre_idx
  on public.course_geometry (centre_lat, centre_lng);

-- Maps one scorecard's hole numbers onto a geometry row. Separate from the geometry so a
-- 27-hole layout can resolve the right nine, and so a bad match is repairable with an
-- update instead of another Overpass fetch.
create table if not exists public.course_geometry_links (
  course_key text primary key,
  geometry_id text not null references public.course_geometry(id) on delete cascade,
  hole_map jsonb not null default '{}'::jsonb,
  matched_by text not null default 'gps',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint course_geometry_links_matched_by_known check (matched_by in ('gps', 'manual')),
  constraint course_geometry_links_hole_map_is_object check (jsonb_typeof(hole_map) = 'object')
);

create index if not exists course_geometry_links_geometry_idx
  on public.course_geometry_links (geometry_id);

comment on table public.course_geometry is
  'Cached OpenStreetMap hole geometry for one physical golf course, ODbL licensed. Independent of tee and of the per-tee rows in public.courses, so a course_snapshot in public.games is never affected.';
comment on column public.course_geometry.id is
  'OSM element reference such as way/134221139 or relation/1158610, or manual/<course key> for greens captured by hand.';
comment on column public.course_geometry.holes is
  'Array of OsmHoleGeometry: {osmId, ref, par, handicap, tee, greenCentre, greenFront, greenBack, greenPolygon, centreline, lengthM}. Every hole OSM knows about, not just the ones a given scorecard plays.';
comment on column public.course_geometry.hazards is
  'Array of CourseHazard: {osmId, kind, outline, centre, radiusM}. Bunkers carry an empty outline and render from centre and radius.';
comment on table public.course_geometry_links is
  'Maps a tee-independent scorecard course key to its geometry row and the hole-by-hole assignment.';
comment on column public.course_geometry_links.course_key is
  'Normalised "name|location" for the physical course, so every tee variant shares one set of greens.';

-- Matches the other tables: RLS on with no policies, so only server routes holding the
-- secret key can read or write. A leaked publishable key still reads nothing.
alter table public.course_geometry enable row level security;
alter table public.course_geometry_links enable row level security;

revoke all on table public.course_geometry from anon, authenticated;
revoke all on table public.course_geometry_links from anon, authenticated;

notify pgrst, 'reload schema';

commit;
