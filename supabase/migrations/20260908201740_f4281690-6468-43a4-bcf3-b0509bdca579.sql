CREATE TABLE public.companion_token_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id uuid NOT NULL REFERENCES public.companion_tokens(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seller_wallet text NOT NULL,
  amount_base_units text NOT NULL,
  price_wei_per_token text NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT companion_token_offers_status_check CHECK (status IN ('active','cancelled'))
);

CREATE UNIQUE INDEX companion_token_offers_one_active
  ON public.companion_token_offers (token_id)
  WHERE status = 'active';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.companion_token_offers TO authenticated;
GRANT SELECT ON public.companion_token_offers TO anon;
GRANT ALL ON public.companion_token_offers TO service_role;

ALTER TABLE public.companion_token_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active offers"
  ON public.companion_token_offers FOR SELECT
  USING (status = 'active');

CREATE POLICY "Sellers view their own offers"
  ON public.companion_token_offers FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Sellers create their own offers"
  ON public.companion_token_offers FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Sellers update their own offers"
  ON public.companion_token_offers FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Sellers delete their own offers"
  ON public.companion_token_offers FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER companion_token_offers_updated_at
  BEFORE UPDATE ON public.companion_token_offers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON public.companion_tokens TO anon;

CREATE POLICY "Anyone can view confirmed companion tokens"
  ON public.companion_tokens FOR SELECT
  USING (status = 'confirmed');