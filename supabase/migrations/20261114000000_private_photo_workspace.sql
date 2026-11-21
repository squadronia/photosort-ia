create type public.event_status as enum (
  'waiting',
  'ready',
  'processing',
  'completed',
  'error'
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  category text not null check (char_length(btrim(category)) between 1 and 60),
  event_date date not null,
  description text not null default '' check (char_length(description) <= 500),
  photo_count integer not null default 0 check (photo_count >= 0),
  cover_photo_id uuid,
  status public.event_status not null default 'waiting',
  is_demo boolean not null default false check (is_demo = false),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  event_id uuid not null,
  original_name text not null check (char_length(original_name) between 1 and 255),
  storage_path text not null unique,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size bigint not null constraint photos_byte_size_limit_check check (byte_size between 1 and 52428800),
  created_at timestamptz not null default now(),
  constraint photos_event_owner_fkey
    foreign key (event_id, owner_id)
    references public.events (id, owner_id)
    on delete cascade
);

create index events_owner_date_idx on public.events (owner_id, event_date desc);
create index photos_owner_event_idx on public.photos (owner_id, event_id, created_at);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger events_set_updated_at
before update on public.events
for each row execute function public.set_updated_at();

create function public.update_event_photo_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.events
    set photo_count = photo_count + 1,
        status = case when status = 'waiting' then 'ready' else status end
    where id = new.event_id and owner_id = new.owner_id;
    return new;
  end if;

  update public.events
  set photo_count = greatest(photo_count - 1, 0)
  where id = old.event_id and owner_id = old.owner_id;
  return old;
end;
$$;

revoke all on function public.update_event_photo_count() from public, anon, authenticated;

create trigger photos_update_event_photo_count
after insert or delete on public.photos
for each row execute function public.update_event_photo_count();

alter table public.events enable row level security;
alter table public.photos enable row level security;

create policy "Owners can read their events"
on public.events for select to authenticated
using ((select auth.uid()) = owner_id);

create policy "Owners can create real events"
on public.events for insert to authenticated
with check ((select auth.uid()) = owner_id and is_demo = false);

create policy "Owners can update their events"
on public.events for update to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id and is_demo = false);

create policy "Owners can delete their events"
on public.events for delete to authenticated
using ((select auth.uid()) = owner_id);

create policy "Owners can read their photos"
on public.photos for select to authenticated
using ((select auth.uid()) = owner_id);

create policy "Owners can add photos to their events"
on public.photos for insert to authenticated
with check (
  (select auth.uid()) = owner_id
  and exists (
    select 1 from public.events
    where events.id = photos.event_id
      and events.owner_id = (select auth.uid())
      and events.is_demo = false
  )
);

create policy "Owners can delete their photos"
on public.photos for delete to authenticated
using ((select auth.uid()) = owner_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'photos',
  'photos',
  false,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Owners can read files in their events"
on storage.objects for select to authenticated
using (
  bucket_id = 'photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.events
    where events.id::text = (storage.foldername(objects.name))[2]
      and events.owner_id = (select auth.uid())
      and events.is_demo = false
  )
);

create policy "Owners can upload files to their events"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.events
    where events.id::text = (storage.foldername(objects.name))[2]
      and events.owner_id = (select auth.uid())
      and events.is_demo = false
  )
);

create policy "Owners can delete files in their events"
on storage.objects for delete to authenticated
using (
  bucket_id = 'photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.events
    where events.id::text = (storage.foldername(objects.name))[2]
      and events.owner_id = (select auth.uid())
      and events.is_demo = false
  )
);
