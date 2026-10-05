-- Apply after accounts-foundation.sql and kitchen-sync.sql.
-- MFA is enforced at the database boundary, including direct REST reads.
begin;
create or replace function public.stocked_identity_allowed() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null)
    and (coalesce(auth.jwt()->>'aal','aal1')='aal2' or not exists(
      select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified'
    ))
$$;
create or replace function public.stocked_verified_user() returns uuid
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.stocked_identity_allowed() then
    raise exception 'Verify your email and complete two-step verification before opening your kitchen.' using errcode='42501';
  end if;
  return auth.uid();
end $$;
create or replace function public.stocked_is_member(h uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select public.stocked_identity_allowed() and exists(
    select 1 from public.stocked_members where home_id=h and user_id=auth.uid()
  )
$$;
create or replace function public.stocked_scope_allowed(kind text,target uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select public.stocked_identity_allowed() and ((kind='personal' and target=auth.uid())
    or (kind='household' and public.stocked_is_member(target)))
$$;
revoke all on function public.stocked_identity_allowed() from public,anon,authenticated;
commit;
