alter table public.events
  add column if not exists cover_photo_id uuid;

update public.events as events
set cover_photo_id = first_photos.id
from (
  select distinct on (event_id) event_id, id
  from public.photos
  order by event_id, created_at asc, id asc
) as first_photos
where events.id = first_photos.event_id
  and events.cover_photo_id is null;
