
-- listing-drafts: owner only (path prefix = user id)
CREATE POLICY "drafts_owner_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'listing-drafts' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "drafts_owner_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'listing-drafts' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "drafts_owner_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'listing-drafts' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "drafts_owner_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'listing-drafts' AND (storage.foldername(name))[1] = auth.uid()::text);

-- listing-public: readable by everyone, written by owner folder
CREATE POLICY "listing_public_read" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'listing-public');
CREATE POLICY "listing_public_owner_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'listing-public' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "listing_public_owner_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'listing-public' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "listing_public_owner_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'listing-public' AND (storage.foldername(name))[1] = auth.uid()::text);

-- avatars: readable by everyone, written by owner folder
CREATE POLICY "avatars_read" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'avatars');
CREATE POLICY "avatars_owner_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "avatars_owner_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "avatars_owner_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
