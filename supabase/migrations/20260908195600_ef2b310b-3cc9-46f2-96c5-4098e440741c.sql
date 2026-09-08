-- Item Passports -------------------------------------------------------------
CREATE TABLE public.item_passports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL UNIQUE REFERENCES public.listings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chain_id INTEGER NOT NULL,
  contract_address TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  metadata_uri TEXT NOT NULL,
  metadata_hash TEXT NOT NULL,
  terms_hash TEXT NOT NULL,
  listing_key TEXT NOT NULL,
  image_hashes JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  token_id NUMERIC(78,0),
  tx_hash TEXT,
  block_number BIGINT,
  status TEXT NOT NULL DEFAULT 'frozen'
    CHECK (status IN ('frozen','submitted','confirmed','failed')),
  failure_reason TEXT,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX item_passports_token_unique
  ON public.item_passports (chain_id, contract_address, token_id)
  WHERE token_id IS NOT NULL;
CREATE UNIQUE INDEX item_passports_tx_unique
  ON public.item_passports (tx_hash) WHERE tx_hash IS NOT NULL;
CREATE INDEX item_passports_user_idx ON public.item_passports (user_id);

GRANT SELECT ON public.item_passports TO authenticated;
GRANT SELECT ON public.item_passports TO anon;
GRANT ALL ON public.item_passports TO service_role;

ALTER TABLE public.item_passports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Confirmed passports are public"
  ON public.item_passports FOR SELECT
  USING (status = 'confirmed');

CREATE POLICY "Owners read their own passports"
  ON public.item_passports FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER item_passports_updated_at
  BEFORE UPDATE ON public.item_passports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Companion Tokens ------------------------------------------------------------
CREATE TABLE public.companion_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passport_id UUID NOT NULL UNIQUE REFERENCES public.item_passports(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chain_id INTEGER NOT NULL,
  factory_address TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  total_supply NUMERIC(78,0) NOT NULL,
  creator_allocation NUMERIC(78,0) NOT NULL,
  token_address TEXT,
  tx_hash TEXT,
  block_number BIGINT,
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted','confirmed','failed')),
  failure_reason TEXT,
  disclaimer_accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX companion_tokens_address_unique
  ON public.companion_tokens (chain_id, token_address) WHERE token_address IS NOT NULL;
CREATE UNIQUE INDEX companion_tokens_tx_unique
  ON public.companion_tokens (tx_hash) WHERE tx_hash IS NOT NULL;
CREATE INDEX companion_tokens_user_idx ON public.companion_tokens (user_id);

GRANT SELECT ON public.companion_tokens TO authenticated;
GRANT SELECT ON public.companion_tokens TO anon;
GRANT ALL ON public.companion_tokens TO service_role;

ALTER TABLE public.companion_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Confirmed companion tokens are public"
  ON public.companion_tokens FOR SELECT
  USING (status = 'confirmed');

CREATE POLICY "Owners read their own companion tokens"
  ON public.companion_tokens FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER companion_tokens_updated_at
  BEFORE UPDATE ON public.companion_tokens
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- On-chain flags may no longer be set by hand ---------------------------------
CREATE OR REPLACE FUNCTION public.guard_onchain_flags()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(current_setting('request.jwt.claim.role', true), auth.role()) = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF NEW.passport_minted IS DISTINCT FROM OLD.passport_minted THEN
    RAISE EXCEPTION 'passport_minted is set only by verified on-chain confirmation';
  END IF;
  IF NEW.companion_token IS DISTINCT FROM OLD.companion_token THEN
    RAISE EXCEPTION 'companion_token is set only by verified on-chain confirmation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER listings_guard_onchain_flags
  BEFORE UPDATE ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.guard_onchain_flags();

-- Demo rows never claim on-chain state
UPDATE public.listings SET passport_minted = false, companion_token = false WHERE is_demo = true;