-- TripFlow: one transactionally updated aggregate per trip.
-- Run once in the Supabase SQL editor, as the project administrator.
begin;

create or replace function public.tripflow_valid_document(doc jsonb, trip_id uuid, account_id uuid)
returns boolean language plpgsql immutable set search_path = '' as $$
declare item jsonb; collection text;
begin
  if jsonb_typeof(doc) <> 'object' or jsonb_typeof(doc->'trip') <> 'object'
     or doc->'trip'->>'id' is distinct from trip_id::text
     or doc->'trip'->>'ownerId' is distinct from account_id::text
     or length(doc->'trip'->>'title') not between 1 and 150 then return false; end if;
  foreach collection in array array['places','entries','photos'] loop
    if jsonb_typeof(doc->collection) is distinct from 'array' then return false; end if;
    if jsonb_array_length(doc->collection) > 20000 then return false; end if;
    for item in select value from jsonb_array_elements(doc->collection) loop
      if item->>'ownerId' is distinct from account_id::text or item->>'tripId' is distinct from trip_id::text then return false; end if;
      if collection = 'photos' and item->>'storagePath' is distinct from account_id::text || '/' || trip_id::text || '/' || (item->>'id') then return false; end if;
    end loop;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create table public.trips (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tripflow_document_shape check (public.tripflow_valid_document(data, id, owner_id)),
  constraint tripflow_revision_match check ((data->>'revision')::integer = revision),
  constraint tripflow_document_size check (octet_length(data::text) <= 10485760)
);
create index trips_owner_updated on public.trips(owner_id, updated_at desc);
alter table public.trips enable row level security;
revoke all on public.trips from anon;
grant select, insert, update, delete on public.trips to authenticated;
create policy "Owner reads own trips" on public.trips for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Owner inserts own trips" on public.trips for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "Owner updates own trips" on public.trips for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "Owner deletes own trips" on public.trips for delete to authenticated using ((select auth.uid()) = owner_id);

create or replace function public.tripflow_revision_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then
    if new.revision <> 1 then raise exception 'New trip revision must be 1'; end if;
  else
    if new.id <> old.id or new.owner_id <> old.owner_id or new.created_at <> old.created_at then raise exception 'Trip identity is immutable'; end if;
    if new.revision <> old.revision + 1 then raise exception 'Revision must increment by one'; end if;
  end if;
  new.updated_at = now();
  return new;
end;
$$;
create trigger tripflow_guard before insert or update on public.trips for each row execute function public.tripflow_revision_guard();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tripflow-photos', 'tripflow-photos', false, 8388608, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 8388608, allowed_mime_types = excluded.allowed_mime_types;

-- Photos may be staged before their trip is inserted. Ownership derives from
-- the authenticated folder, never from client metadata or a public URL.
create policy "TripFlow private photo read" on storage.objects for select to authenticated
using (bucket_id = 'tripflow-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "TripFlow private photo insert" on storage.objects for insert to authenticated
with check (bucket_id = 'tripflow-photos' and (storage.foldername(name))[1] = (select auth.uid())::text
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$');
create policy "TripFlow private photo update" on storage.objects for update to authenticated
using (bucket_id = 'tripflow-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'tripflow-photos' and (storage.foldername(name))[1] = (select auth.uid())::text
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$');
create policy "TripFlow private photo delete" on storage.objects for delete to authenticated
using (bucket_id = 'tripflow-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
commit;
