begin;

-- Mapped tree cover beside each hole, kept apart from hazards. Android builds already on
-- phones read hazards and draw any kind they do not know as water, so trees go in a column
-- those builds never ask for.
alter table public.course_geometry
  add column if not exists trees jsonb not null default '[]'::jsonb;

alter table public.course_geometry
  drop constraint if exists course_geometry_trees_is_array;
alter table public.course_geometry
  add constraint course_geometry_trees_is_array check (jsonb_typeof(trees) = 'array');

comment on column public.course_geometry.trees is
  'Array of TreeArea: {osmId, outline, centre, radiusM}. OSM natural=wood and landuse=forest outlines within reach of a hole. Only as complete as local mapping.';

notify pgrst, 'reload schema';

commit;
