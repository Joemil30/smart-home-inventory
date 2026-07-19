-- Cold Room — family sync schema.
-- Run this once in your Supabase project: SQL Editor -> paste -> Run.
-- (The app also offers a "Copy setup SQL" button that copies this.)

create table if not exists public.sync (
  household   text not null,
  store       text not null,
  id          text not null,
  data        jsonb,
  updated_at  timestamptz default now(),
  deleted     boolean default false,
  primary key (household, store, id)
);

-- Row Level Security. The anon key + your (random) household code are the
-- shared family secret; keep them within the family. For grocery data this
-- is a reasonable trade-off. Tighten later with real auth if you want.
alter table public.sync enable row level security;
create policy "family access" on public.sync
  for all using (true) with check (true);

-- Enable realtime so every phone sees changes live.
alter publication supabase_realtime add table public.sync;
