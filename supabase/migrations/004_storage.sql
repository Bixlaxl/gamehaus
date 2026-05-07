-- ============================================================
-- 004_storage.sql
-- Supabase Storage bucket for table images
-- ============================================================

-- Create the table-images bucket (public read, auth write)
insert into storage.buckets (id, name, public)
values ('table-images', 'table-images', true)
on conflict (id) do nothing;

-- Owner can upload/delete images
create policy "Owner can upload table images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'table-images'
    and auth.jwt() ->> 'role' = 'owner'
  );

create policy "Owner can update table images"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'table-images'
    and auth.jwt() ->> 'role' = 'owner'
  );

create policy "Owner can delete table images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'table-images'
    and auth.jwt() ->> 'role' = 'owner'
  );

-- Anyone can view images (bucket is public)
create policy "Public can view table images"
  on storage.objects for select to anon
  using (bucket_id = 'table-images');
