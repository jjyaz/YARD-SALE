-- 1. Voucher versioning + content addressing on passports -------------------
ALTER TABLE public.item_passports
  ADD COLUMN IF NOT EXISTS voucher_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS voucher_nonce text,
  ADD COLUMN IF NOT EXISTS voucher_issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS voucher_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata_cid text,
  ADD COLUMN IF NOT EXISTS image_cids jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 2. Live-quote + locker lifecycle on liquidity positions --------------------
ALTER TABLE public.liquidity_positions
  ADD COLUMN IF NOT EXISTS quote_amount0_used text,
  ADD COLUMN IF NOT EXISTS quote_amount1_used text,
  ADD COLUMN IF NOT EXISTS quote_amount0_excess text,
  ADD COLUMN IF NOT EXISTS quote_amount1_excess text,
  ADD COLUMN IF NOT EXISTS quote_liquidity text,
  ADD COLUMN IF NOT EXISTS collect_fees_tx_hash text,
  ADD COLUMN IF NOT EXISTS collected_amount0 text,
  ADD COLUMN IF NOT EXISTS collected_amount1 text,
  ADD COLUMN IF NOT EXISTS fees_collected_at timestamptz,
  ADD COLUMN IF NOT EXISTS withdraw_tx_hash text,
  ADD COLUMN IF NOT EXISTS lock_withdrawn_at timestamptz;

-- 3. Frozen media is immutable at the database level -------------------------
CREATE OR REPLACE FUNCTION public.guard_frozen_listing_media()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_listing uuid;
  is_frozen boolean;
BEGIN
  target_listing := COALESCE(OLD.listing_id, NEW.listing_id);
  SELECT EXISTS (
    SELECT 1 FROM public.item_passports p
    WHERE p.listing_id = target_listing
      AND p.status IN ('frozen', 'submitted', 'confirmed')
  ) INTO is_frozen;
  IF is_frozen THEN
    RAISE EXCEPTION 'These photos are frozen into an Item Passport and can no longer be changed or removed.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS listing_media_frozen_guard ON public.listing_media;
CREATE TRIGGER listing_media_frozen_guard
  BEFORE UPDATE OR DELETE ON public.listing_media
  FOR EACH ROW EXECUTE FUNCTION public.guard_frozen_listing_media();

-- 4. The stored image files are protected too --------------------------------
CREATE OR REPLACE FUNCTION public.storage_object_is_frozen(object_name text, bucket text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.listing_media m
    JOIN public.item_passports p ON p.listing_id = m.listing_id
    WHERE m.storage_path = object_name
      AND bucket IN ('listing-public', 'listing-drafts')
      AND p.status IN ('frozen', 'submitted', 'confirmed')
  );
$$;

GRANT EXECUTE ON FUNCTION public.storage_object_is_frozen(text, text) TO authenticated, anon, service_role;

DROP POLICY IF EXISTS "Frozen passport media cannot be replaced" ON storage.objects;
CREATE POLICY "Frozen passport media cannot be replaced"
  ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.storage_object_is_frozen(name, bucket_id));

DROP POLICY IF EXISTS "Frozen passport media cannot be deleted" ON storage.objects;
CREATE POLICY "Frozen passport media cannot be deleted"
  ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.storage_object_is_frozen(name, bucket_id));