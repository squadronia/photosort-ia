drop policy if exists "Owners can read files in their events" on storage.objects;
drop policy if exists "Owners can upload files to their events" on storage.objects;
drop policy if exists "Owners can delete files in their events" on storage.objects;

create policy "Owners can read files in their events"
on storage.objects for select to authenticated
using (
  bucket_id = 'photos'
  and (storage.foldername(objects.name))[1] = (select auth.uid())::text
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
  and (storage.foldername(objects.name))[1] = (select auth.uid())::text
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
  and (storage.foldername(objects.name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.events
    where events.id::text = (storage.foldername(objects.name))[2]
      and events.owner_id = (select auth.uid())
      and events.is_demo = false
  )
);
