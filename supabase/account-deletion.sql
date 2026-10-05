-- Transactional cleanup when Supabase Auth deletes a user. Applied after sync.
-- Shared contributions remain with the household, with their author unlinked.
begin;
alter table public.stocked_records alter column updated_by drop not null;
alter table public.stocked_records drop constraint if exists stocked_records_updated_by_fkey;
alter table public.stocked_records add constraint stocked_records_updated_by_fkey
  foreign key(updated_by) references auth.users(id) on delete set null;
create or replace function public.stocked_before_account_delete() returns trigger
language plpgsql security definer set search_path='' as $$
declare h uuid; own boolean;
begin
  select home_id,role='owner' into h,own from public.stocked_members where user_id=old.id;
  if h is not null then
    perform 1 from public.stocked_homes where id=h for update;
    select role='owner' into own from public.stocked_members where home_id=h and user_id=old.id;
    if own and exists(select 1 from public.stocked_members where home_id=h and user_id<>old.id) then
      raise exception 'Transfer household ownership before deleting your account.' using errcode='23514';
    end if;
    delete from public.stocked_members where user_id=old.id;
    if not exists(select 1 from public.stocked_members where home_id=h) then
      delete from public.stocked_records where scope_type='household' and scope_id=h;
      delete from public.stocked_operations where request->>'kind'='household' and request->>'target'=h::text;
      delete from public.stocked_homes where id=h;
    end if;
  end if;
  delete from public.stocked_records where scope_type='personal' and scope_id=old.id;
  delete from public.stocked_operations where user_id=old.id;
  return old;
end $$;
revoke all on function public.stocked_before_account_delete() from public,anon,authenticated;
drop trigger if exists stocked_account_cleanup on auth.users;
create trigger stocked_account_cleanup before delete on auth.users
  for each row execute function public.stocked_before_account_delete();
commit;
