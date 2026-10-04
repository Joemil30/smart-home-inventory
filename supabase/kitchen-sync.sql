-- Apply AFTER accounts-foundation.sql to an isolated staging project.
-- Personal and household records are separate. No legacy data is migrated.
begin;
create table if not exists public.stocked_records (
  scope_id uuid not null,
  scope_type text not null check(scope_type in ('personal','household')),
  store text not null check(store in ('items','catalog','saved','shopping','plan','meta')),
  record_id text not null check(length(record_id) between 1 and 160),
  body jsonb not null check(jsonb_typeof(body)='object'),
  version integer not null check(version>0),
  deleted boolean not null default false,
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key(scope_type,scope_id,store,record_id),
  check(store<>'meta' or record_id='household'),
  check(octet_length(body::text)<=524288)
);
create table if not exists public.stocked_operations (
  user_id uuid not null references auth.users(id) on delete restrict,
  operation_id uuid not null,
  request jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(user_id,operation_id)
);
alter table public.stocked_records enable row level security;
alter table public.stocked_operations enable row level security;
revoke all on public.stocked_records,public.stocked_operations from public,anon,authenticated;

-- Server authorization is mandatory even for household owners. An owner never
-- receives access to another person's private records.
create or replace function public.stocked_scope_allowed(kind text,target uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null)
    and ((kind='personal' and target=auth.uid()) or
      (kind='household' and public.stocked_is_member(target)))
$$;
grant select on public.stocked_records to authenticated;
drop policy if exists stocked_records_read on public.stocked_records;
create policy stocked_records_read on public.stocked_records for select to authenticated
  using(public.stocked_scope_allowed(scope_type,scope_id));

-- Serialize writes with membership changes. Recheck authorization AFTER locking.
create or replace function public.stocked_lock_scope(kind text,target uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform public.stocked_verified_user();
  if kind='household' then
    perform 1 from public.stocked_homes where id=target for update;
  elsif kind='personal' then
    perform 1 from auth.users where id=auth.uid() for update;
  end if;
  if not public.stocked_scope_allowed(kind,target) then
    raise exception 'Kitchen access changed. Sign in and check your household.' using errcode='42501';
  end if;
  if to_regclass('public.sync') is not null then raise exception 'Legacy project requires review.'; end if;
end $$;

create or replace function public.stocked_kitchen_read(kind text,target uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare records jsonb;
begin
  perform public.stocked_lock_scope(kind,target);
  -- A complete snapshot, never a silently truncated PostgREST row limit.
  if (select count(*) from public.stocked_records where scope_type=kind and scope_id=target)>5000 then
    raise exception 'Kitchen is too large for this sync version. Contact the operator; no records were removed.';
  end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by store,record_id),'[]'::jsonb) into records
    from public.stocked_records r where scope_type=kind and scope_id=target;
  return jsonb_build_object('protocol',1,'records',records);
end $$;

create or replace function public.stocked_kitchen_write(kind text,target uuid,bucket text,key text,
  payload jsonb,base_version integer,remove_record boolean,op uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.stocked_verified_user(); old public.stocked_records;
  previous public.stocked_operations; request_data jsonb; result_data jsonb;
begin
  -- User lock prevents operation-id races across this user's scopes.
  perform 1 from auth.users where id=u for update;
  perform public.stocked_lock_scope(kind,target);
  if op is null or bucket is null or bucket not in ('items','catalog','saved','shopping','plan','meta')
    or key is null or length(key) not between 1 and 160 or (bucket='meta' and key<>'household')
    or payload is null or jsonb_typeof(payload)<>'object' or payload->>'id' is distinct from key
    or octet_length(payload::text)>524288 or base_version is null or base_version<0 or remove_record is null then
    raise exception 'Invalid kitchen record.' using errcode='22023';
  end if;
  request_data:=jsonb_build_object('kind',kind,'target',target,'bucket',bucket,'key',key,'payload',payload,'base',base_version,'remove',remove_record);
  select * into previous from public.stocked_operations where user_id=u and operation_id=op;
  if found then
    if previous.request<>request_data then raise exception 'Operation identifier was reused with different data.' using errcode='22023'; end if;
    return previous.result;
  end if;
  select * into old from public.stocked_records where scope_type=kind and scope_id=target and store=bucket and record_id=key;
  if coalesce(old.version,0)<>base_version then
    -- Preserve both versions; the client must explicitly resolve, not overwrite.
    return jsonb_build_object('conflict',true,'record',case when old.version is null then null else to_jsonb(old) end);
  end if;
  if old.version is null and (select count(*) from public.stocked_records where scope_type=kind and scope_id=target)>=5000 then
    raise exception 'Kitchen record limit reached. No records were removed.';
  end if;
  insert into public.stocked_records(scope_type,scope_id,store,record_id,body,version,deleted,updated_by)
    values(kind,target,bucket,key,payload,base_version+1,remove_record,u)
    on conflict(scope_type,scope_id,store,record_id) do update set
      body=excluded.body,version=excluded.version,deleted=excluded.deleted,updated_by=u,updated_at=now()
    returning jsonb_build_object('conflict',false,'record',to_jsonb(stocked_records)) into result_data;
  insert into public.stocked_operations(user_id,operation_id,request,result) values(u,op,request_data,result_data);
  return result_data;
end $$;

create or replace function public.stocked_cloud_status() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('protocol',1,'ready',to_regclass('public.sync') is null,'inventorySync',true,'syncProtocol',1)
$$;
revoke all on function public.stocked_scope_allowed(text,uuid),public.stocked_lock_scope(text,uuid),
  public.stocked_kitchen_read(text,uuid),public.stocked_kitchen_write(text,uuid,text,text,jsonb,integer,boolean,uuid)
  from public,anon,authenticated;
grant execute on function public.stocked_scope_allowed(text,uuid),public.stocked_kitchen_read(text,uuid),
  public.stocked_kitchen_write(text,uuid,text,text,jsonb,integer,boolean,uuid) to authenticated;
commit;
