alter table public.photos
  add column burst_id text,
  add column burst_category text not null default 'unprocessed'
    check (burst_category in ('unprocessed', 'complete', 'excess', 'review')),
  add column burst_position integer
    check (burst_position is null or burst_position > 0),
  add column burst_size integer
    check (burst_size is null or burst_size > 0),
  add column captured_at timestamptz,
  add column camera_label text,
  add column review_reason text
    check (review_reason is null or review_reason in (
      'missing_capture_time',
      'invalid_metadata',
      'ambiguous_sequence'
    )),
  add column sha256 text;

create index photos_event_burst_position_idx
  on public.photos (event_id, burst_id, burst_category, burst_position);

grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.events, public.photos to authenticated;
