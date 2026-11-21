alter table public.photos
  drop constraint if exists photos_byte_size_check,
  drop constraint if exists photos_byte_size_limit_check;

alter table public.photos
  add constraint photos_byte_size_limit_check
  check (byte_size between 1 and 52428800);

update storage.buckets
set file_size_limit = 52428800
where id = 'photos';
