-- ===========================================================================
-- Storage for the preview images X shows under a shared link
--
-- Why this storage is needed at all:
--
-- A poll's image is drawn in the browser. But the visitor who clicks the link
-- on X isn't the first one to open it - the first is X's crawler, and it
-- doesn't run JavaScript. It reads the meta tags in the page head and fetches
-- exactly the address given there as the image. So the image has to already
-- be sitting somewhere finished before the link gets posted.
--
-- So: as soon as Ansem creates a poll, his browser uploads the image here.
-- The public bucket serves it without login - it has to, because the crawler
-- doesn't have one.
--
-- That the image then says "0 votes" is not a defect: that is exactly what
-- the poll looks like at the moment the link gets posted. And X caches the
-- card anyway - a later refreshed image wouldn't arrive there for days.
-- ===========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('og', 'og', true, 4194304, array['image/png'])
on conflict (id) do update
  set public = true,
      file_size_limit = 4194304,
      allowed_mime_types = array['image/png'];

-- Anyone may read, even without login. X's crawler carries no token, and a
-- preview image is meant for the public anyway - it ends up sitting in a
-- timeline.
drop policy if exists og_read on storage.objects;
create policy og_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'og');

-- Only Ansem may write. app.is_admin() reads the wallet from the same token
-- used for messages and polls - storage policies are ordinary RLS policies
-- on storage.objects, so the same function applies.
drop policy if exists og_admin_write on storage.objects;
create policy og_admin_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'og' and app.is_admin());

-- Separate from insert, because re-uploading the same name is an update.
-- Without this policy, refreshing a card would go nowhere.
drop policy if exists og_admin_update on storage.objects;
create policy og_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'og' and app.is_admin())
  with check (bucket_id = 'og' and app.is_admin());

-- Delete as well: when a poll is deleted, its image shouldn't stay behind
-- as a corpse.
drop policy if exists og_admin_delete on storage.objects;
create policy og_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'og' and app.is_admin());

-- On startup, Ansem's browser backfills any missing cards. For that it needs
-- to list once what's already there - otherwise it would have to check each
-- poll individually. Listing runs through the same select policy as reading
-- (og_read), which already applies to everyone. This note just exists so no
-- one thinks that policy is redundant and removes it.
