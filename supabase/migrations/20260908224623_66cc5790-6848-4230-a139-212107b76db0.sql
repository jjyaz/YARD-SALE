ALTER TABLE public.item_passports
  ADD COLUMN IF NOT EXISTS ipfs_cid text,
  ADD COLUMN IF NOT EXISTS ipfs_pinned_at timestamptz,
  ADD COLUMN IF NOT EXISTS storage_url text,
  ADD COLUMN IF NOT EXISTS attestation jsonb,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_reconciled_at timestamptz;

ALTER TABLE public.companion_tokens
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS implementation_address text,
  ADD COLUMN IF NOT EXISTS bytecode_hash text;

CREATE TABLE public.liquidity_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id uuid NOT NULL UNIQUE REFERENCES public.companion_tokens(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chain_id integer NOT NULL,
  wallet_address text NOT NULL,
  token_address text NOT NULL,
  weth_address text NOT NULL,
  position_manager text NOT NULL,
  factory_address text NOT NULL,
  fee_tier integer NOT NULL DEFAULT 3000,
  token0 text NOT NULL,
  token1 text NOT NULL,
  sqrt_price_x96 text NOT NULL,
  tick_lower integer NOT NULL,
  tick_upper integer NOT NULL,
  token_amount text NOT NULL,
  eth_amount text NOT NULL,
  amount0_min text NOT NULL,
  amount1_min text NOT NULL,
  slippage_bps integer NOT NULL DEFAULT 100,
  deadline_seconds integer NOT NULL DEFAULT 1200,
  wrap_tx_hash text,
  weth_approve_tx_hash text,
  token_approve_tx_hash text,
  pool_tx_hash text,
  mint_tx_hash text,
  pool_address text,
  position_token_id text,
  liquidity text,
  step text NOT NULL DEFAULT 'wrap',
  status text NOT NULL DEFAULT 'planned',
  failure_reason text,
  risk_accepted_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT liquidity_positions_status_check CHECK (status IN ('planned','in_progress','confirmed','failed')),
  CONSTRAINT liquidity_positions_step_check CHECK (step IN ('wrap','approve_weth','approve_token','create_pool','mint','done')),
  CONSTRAINT liquidity_positions_fee_check CHECK (fee_tier IN (500, 3000, 10000)),
  CONSTRAINT liquidity_positions_slippage_check CHECK (slippage_bps BETWEEN 1 AND 5000)
);

CREATE INDEX liquidity_positions_listing_idx ON public.liquidity_positions(listing_id);
CREATE INDEX liquidity_positions_user_idx ON public.liquidity_positions(user_id);

GRANT SELECT ON public.liquidity_positions TO anon;
GRANT SELECT ON public.liquidity_positions TO authenticated;
GRANT ALL ON public.liquidity_positions TO service_role;

ALTER TABLE public.liquidity_positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Creators see their own liquidity records"
  ON public.liquidity_positions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Anyone can see confirmed liquidity positions"
  ON public.liquidity_positions FOR SELECT TO anon, authenticated
  USING (status = 'confirmed');

CREATE TRIGGER liquidity_positions_updated_at
  BEFORE UPDATE ON public.liquidity_positions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();