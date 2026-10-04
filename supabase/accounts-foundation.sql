-- Stocked accounts foundation. Apply only to a reviewed STAGING project first.
-- Does not alter legacy sync tables/policies or upload any household inventory.
-- All membership writes go through authenticated, transaction-safe RPCs.
begin;

create table if not exists public.stocked_homes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);
create table if not exists public.stocked_members (
  home_id uuid not null references public.stocked_homes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  display_name text not null check (length(btrim(display_name)) between 1 and 60),
  role text not null check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  primary key (home_id,user_id),
  unique(user_id) -- V1: one cloud household per account, no accidental cross-home merging.
);
create unique index if not exists stocked_one_owner on public.stocked_members(home_id) where role='owner';
create table if not exists public.stocked_invites (
  id uuid primary key default gen_random_uuid(),
  home_id uuid not null references public.stocked_homes(id) on delete cascade,
  token_hash text unique not null,
  expires_at timestamptz not null default (now()+interval '2 days'),
  consumed_by uuid references auth.users(id) on delete set null,
  consumed_at timestamptz,
  revoked boolean not null default false
);
alter table public.stocked_homes enable row level security;
alter table public.stocked_members enable row level security;
alter table public.stocked_invites enable row level security;
revoke all on public.stocked_homes,public.stocked_members,public.stocked_invites from public,anon,authenticated;
grant select on public.stocked_homes,public.stocked_members to authenticated;

create or replace function public.stocked_verified_user() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare u uuid := auth.uid();
begin
  if u is null or not exists(select 1 from auth.users where id=u and email_confirmed_at is not null) then
    raise exception 'Verify your email and sign in first.' using errcode='42501';
  end if;
  return u;
end $$;
create or replace function public.stocked_is_member(h uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.stocked_members where home_id=h and user_id=auth.uid())
$$;
drop policy if exists stocked_home_read on public.stocked_homes;
create policy stocked_home_read on public.stocked_homes for select to authenticated using(public.stocked_is_member(id));
drop policy if exists stocked_roster_read on public.stocked_members;
create policy stocked_roster_read on public.stocked_members for select to authenticated using(public.stocked_is_member(home_id));

-- Fail closed if an operator tries to repurpose the old code-only sync project.
-- This is a conservative deployment gate, not an automatic legacy migration.
create or replace function public.stocked_cloud_status() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('protocol',1,'ready',to_regclass('public.sync') is null,'inventorySync',false)
$$;
create or replace function public.stocked_account_home() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid := public.stocked_verified_user(); h uuid;
begin
  select home_id into h from public.stocked_members where user_id=u;
  if h is null then return null; end if;
  return (select jsonb_build_object('id',id,'name',name,'role',(select role from public.stocked_members where user_id=u),
    'members',(select jsonb_agg(jsonb_build_object('user_id',user_id,'name',display_name,'role',role) order by joined_at,user_id)
    from public.stocked_members where home_id=h)) from public.stocked_homes where id=h);
end $$;
create or replace function public.stocked_create_home(home_name text,member_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid := public.stocked_verified_user(); h uuid;
begin
  if to_regclass('public.sync') is not null then raise exception 'Legacy project requires review before cloud activation.'; end if;
  -- Serialize create/join requests by user, preventing orphan homes on double taps.
  perform 1 from auth.users where id=u for update;
  if exists(select 1 from public.stocked_members where user_id=u) then return public.stocked_account_home(); end if;
  if home_name is null or length(btrim(home_name)) not between 1 and 80 or member_name is null or length(btrim(member_name)) not between 1 and 60 then
    raise exception 'Enter a household name and your name.' using errcode='22023';
  end if;
  insert into public.stocked_homes(name) values(btrim(home_name)) returning id into h;
  insert into public.stocked_members(home_id,user_id,display_name,role) values(h,u,btrim(member_name),'owner');
  return public.stocked_account_home();
end $$;
create or replace function public.stocked_create_invite() returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid := public.stocked_verified_user(); h uuid; token text; expiry timestamptz;
begin
  select home_id into h from public.stocked_members where user_id=u and role='owner';
  if h is null then raise exception 'Only the household owner can invite people.' using errcode='42501'; end if;
  perform 1 from public.stocked_homes where id=h for update;
  -- Recheck after acquiring the home lock, in case ownership changed while waiting.
  if not exists(select 1 from public.stocked_members where home_id=h and user_id=u and role='owner') then raise exception 'Household access changed.' using errcode='42501'; end if;
  update public.stocked_invites set revoked=true where home_id=h and consumed_at is null;
  token := replace(gen_random_uuid()::text || gen_random_uuid()::text,'-','');
  insert into public.stocked_invites(home_id,token_hash)
    values(h,encode(sha256(convert_to(token,'UTF8')),'hex')) returning expires_at into expiry;
  return jsonb_build_object('token',token,'expiresAt',expiry);
end $$;
create or replace function public.stocked_revoke_invites() returns void
language plpgsql security definer set search_path='' as $$
declare u uuid := public.stocked_verified_user(); h uuid;
begin
  select home_id into h from public.stocked_members where user_id=u and role='owner';
  if h is null then raise exception 'Only the household owner can revoke invitations.' using errcode='42501'; end if;
  perform 1 from public.stocked_homes where id=h for update;
  if not exists(select 1 from public.stocked_members where home_id=h and user_id=u and role='owner') then raise exception 'Household access changed.' using errcode='42501'; end if;
  update public.stocked_invites set revoked=true where home_id=h;
end $$;
create or replace function public.stocked_preview_invite(invite_token text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid := public.stocked_verified_user(); result jsonb;
begin
  if invite_token is null or invite_token !~ '^[a-f0-9]{64}$' then raise exception 'This invitation is invalid or expired.' using errcode='22023'; end if;
  select jsonb_build_object('name',h.name,'owner',m.display_name) into result
    from public.stocked_invites i join public.stocked_homes h on h.id=i.home_id
    join public.stocked_members m on m.home_id=h.id and m.role='owner'
    where i.token_hash=encode(sha256(convert_to(invite_token,'UTF8')),'hex')
      and not i.revoked and i.expires_at>now() and i.consumed_at is null;
  if result is null then raise exception 'This invitation is invalid or expired.' using errcode='22023'; end if;
  return result;
end $$;
create or replace function public.stocked_join_home(invite_token text,member_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid := public.stocked_verified_user(); inv public.stocked_invites; current_home uuid;
begin
  if to_regclass('public.sync') is not null then raise exception 'Legacy project requires review before cloud activation.'; end if;
  if invite_token is null or invite_token !~ '^[a-f0-9]{64}$' then raise exception 'This invitation is invalid or expired.' using errcode='22023'; end if;
  if member_name is null or length(btrim(member_name)) not between 1 and 60 then raise exception 'Enter your name.' using errcode='22023'; end if;
  perform 1 from auth.users where id=u for update;
  select * into inv from public.stocked_invites where token_hash=encode(sha256(convert_to(invite_token,'UTF8')),'hex') for update;
  if not found or inv.revoked or inv.expires_at<=now() then raise exception 'This invitation is invalid or expired.' using errcode='22023'; end if;
  select home_id into current_home from public.stocked_members where user_id=u;
  if current_home=inv.home_id then return public.stocked_account_home(); end if;
  if current_home is not null then raise exception 'Leave your current household before joining another.' using errcode='22023'; end if;
  if inv.consumed_at is not null then raise exception 'This invitation is invalid or expired.' using errcode='22023'; end if;
  insert into public.stocked_members(home_id,user_id,display_name,role) values(inv.home_id,u,btrim(member_name),'member');
  update public.stocked_invites set consumed_by=u,consumed_at=now() where id=inv.id;
  return public.stocked_account_home();
end $$;
create or replace function public.stocked_remove_member(member_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid := public.stocked_verified_user(); h uuid;
begin
  select home_id into h from public.stocked_members where user_id=u;
  if h is null then raise exception 'No household membership.' using errcode='42501'; end if;
  perform 1 from public.stocked_homes where id=h for update;
  if member_id<>u and not exists(select 1 from public.stocked_members where home_id=h and user_id=u and role='owner') then
    raise exception 'Only the owner can remove other members.' using errcode='42501';
  end if;
  if exists(select 1 from public.stocked_members where home_id=h and user_id=member_id and role='owner') then
    raise exception 'Transfer ownership before leaving.' using errcode='22023';
  end if;
  delete from public.stocked_members where home_id=h and user_id=member_id and role='member';
end $$;
create or replace function public.stocked_transfer_home(member_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid := public.stocked_verified_user(); h uuid;
begin
  select home_id into h from public.stocked_members where user_id=u and role='owner';
  if h is null then raise exception 'Only the owner can transfer ownership.' using errcode='42501'; end if;
  perform 1 from public.stocked_homes where id=h for update;
  if not exists(select 1 from public.stocked_members where home_id=h and user_id=u and role='owner') then raise exception 'Household access changed.' using errcode='42501'; end if;
  if member_id is null or member_id=u or not exists(select 1 from public.stocked_members where home_id=h and user_id=member_id and role='member') then
    raise exception 'Choose another member of this household.' using errcode='22023';
  end if;
  update public.stocked_members set role='member' where home_id=h and user_id=u;
  update public.stocked_members set role='owner' where home_id=h and user_id=member_id;
  update public.stocked_invites set revoked=true where home_id=h and consumed_at is null;
end $$;

-- Explicit per-function grants; no broad grant on all functions in public.
revoke all on function public.stocked_verified_user(),public.stocked_is_member(uuid),public.stocked_cloud_status(),public.stocked_account_home(),public.stocked_create_home(text,text),public.stocked_create_invite(),public.stocked_revoke_invites(),public.stocked_preview_invite(text),public.stocked_join_home(text,text),public.stocked_remove_member(uuid),public.stocked_transfer_home(uuid) from public,anon,authenticated;
grant execute on function public.stocked_is_member(uuid),public.stocked_cloud_status(),public.stocked_account_home(),public.stocked_create_home(text,text),public.stocked_create_invite(),public.stocked_revoke_invites(),public.stocked_preview_invite(text),public.stocked_join_home(text,text),public.stocked_remove_member(uuid),public.stocked_transfer_home(uuid) to authenticated;
commit;
