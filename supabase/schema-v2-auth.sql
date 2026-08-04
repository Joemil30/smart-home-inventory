-- ============================================================
-- Cold Room / Stocked — hardened sync schema, v2
--
-- This REPLACES the `using (true)` policy in schema.sql. That policy is
-- safe only while every household runs its own Supabase project and holds
-- its own anon key — the family IS the tenant. The moment one backend
-- serves several households it becomes a total data breach, because the
-- anon key ships inside the app and can be read out of the binary.
--
-- What changes: the database, not the client, decides what you may see.
-- Membership is a row in household_members keyed on auth.uid(), and every
-- policy is derived from it.
--
-- HOW TO RUN (one time, in your Supabase project):
--   Dashboard -> SQL Editor -> New query -> paste all of this -> Run.
-- It is safe to run on a project that already has schema.sql applied; the
-- old permissive policy is dropped explicitly at the end.
-- ============================================================

-- ---------- 1. who belongs to which household ----------
create table if not exists public.household_members (
  household   text not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  display     text,
  role        text not null default 'member',      -- 'owner' | 'member'
  joined_at   timestamptz not null default now(),
  primary key (household, user_id)
);

-- A short, human-typeable code that grants membership when redeemed.
-- Separate from the household id so a leaked code can be rotated without
-- migrating anyone's data.
create table if not exists public.household_invites (
  code        text primary key,
  household   text not null,
  created_by  uuid not null references auth.users(id) on delete cascade,
  expires_at  timestamptz not null default (now() + interval '7 days'),
  max_uses    int  not null default 5,
  uses        int  not null default 0
);

-- ---------- 2. the helper every policy leans on ----------
-- SECURITY DEFINER so the function may read household_members even while
-- RLS hides rows from the caller. Without this the membership check would
-- have to consult a table the caller cannot see, and every policy fails
-- closed. STABLE so Postgres can cache it per statement.
create or replace function public.is_member(h text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.household_members m
    where m.household = h and m.user_id = auth.uid()
  );
$$;

revoke all on function public.is_member(text) from public;
grant execute on function public.is_member(text) to authenticated;

-- ---------- 3. the sync table, now fenced ----------
create table if not exists public.sync (
  household   text not null,
  store       text not null,
  id          text not null,
  data        jsonb,
  updated_at  timestamptz default now(),
  deleted     boolean default false,
  primary key (household, store, id)
);

alter table public.sync              enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;

-- The old open door. Dropped by name AND defensively by any name, because a
-- project that ran an earlier revision may carry a differently-named twin.
drop policy if exists "family access" on public.sync;
do $$
declare p record;
begin
  for p in select policyname from pg_policies
           where schemaname = 'public' and tablename = 'sync'
             and policyname <> 'household members only'
  loop
    execute format('drop policy %I on public.sync', p.policyname);
  end loop;
end $$;

create policy "household members only" on public.sync
  for all
  using      (public.is_member(household))
  with check (public.is_member(household));

-- You may read the roster of households you belong to, and nothing else.
create policy "see my households" on public.household_members
  for select using (public.is_member(household));

-- Leaving is allowed; adding yourself to someone else's household is not —
-- that only happens through redeem_invite() below, which checks the code.
create policy "leave a household" on public.household_members
  for delete using (user_id = auth.uid());

-- Invites are readable only by the household they belong to. Redemption
-- deliberately does NOT go through select, so a code cannot be discovered
-- by querying the table.
create policy "see my invites" on public.household_invites
  for select using (public.is_member(household));
create policy "make invites for my household" on public.household_invites
  for insert with check (public.is_member(household) and created_by = auth.uid());
create policy "revoke my invites" on public.household_invites
  for delete using (public.is_member(household));

-- ---------- 4. joining ----------
-- Creating a household makes you its owner in one transaction, so there is
-- never a moment where a household exists that nobody can read.
create or replace function public.create_household(h text, display text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from public.household_members where household = h) then
    raise exception 'household already exists';
  end if;
  insert into public.household_members (household, user_id, display, role)
  values (h, auth.uid(), display, 'owner');
  return h;
end $$;

create or replace function public.redeem_invite(invite_code text, display text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare inv public.household_invites;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into inv from public.household_invites
    where code = invite_code and expires_at > now() and uses < max_uses
    for update;
  if inv is null then raise exception 'that invite is not valid any more'; end if;

  insert into public.household_members (household, user_id, display)
  values (inv.household, auth.uid(), display)
  on conflict (household, user_id) do nothing;

  update public.household_invites set uses = uses + 1 where code = inv.code;
  return inv.household;
end $$;

revoke all on function public.create_household(text, text) from public;
revoke all on function public.redeem_invite(text, text)    from public;
grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.redeem_invite(text, text)    to authenticated;

-- ---------- 5. account deletion ----------
-- Apple App Store Guideline 5.1.1(v): an account created in the app must be
-- deletable IN the app. Not by email, not by a web form.
--
-- Leaving every household is enough to make the data unreachable, but that
-- is not the same as deleted, so the last member out takes the rows with
-- them. auth.users deletion itself is done from the client with
-- supabase.auth.admin? No — that needs a service key, which must never ship.
-- The client calls this, then signs out; the auth row is reaped by the
-- `delete-account` Edge Function using the service key server-side.
create or replace function public.purge_my_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare h text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  for h in select household from public.household_members where user_id = auth.uid() loop
    delete from public.household_members where household = h and user_id = auth.uid();
    -- Last one out clears the household's rows; otherwise the family keeps theirs.
    if not exists (select 1 from public.household_members where household = h) then
      delete from public.sync             where household = h;
      delete from public.household_invites where household = h;
    end if;
  end loop;
end $$;

revoke all on function public.purge_my_data() from public;
grant execute on function public.purge_my_data() to authenticated;

-- ---------- 6. realtime ----------
do $$
begin
  alter publication supabase_realtime add table public.sync;
exception when duplicate_object then null;
end $$;

-- ---------- 7. prove it ----------
-- Run this after applying. Any row returned is a hole.
--   select tablename, policyname, qual
--   from pg_policies
--   where schemaname='public' and (qual = 'true' or with_check = 'true');
