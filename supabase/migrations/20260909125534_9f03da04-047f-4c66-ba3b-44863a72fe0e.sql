ALTER TABLE public.liquidity_positions
  ADD COLUMN IF NOT EXISTS acknowledged_pool_price_x96 text,
  ADD COLUMN IF NOT EXISTS acknowledged_pool_price_at timestamptz,
  ADD COLUMN IF NOT EXISTS locker_address text,
  ADD COLUMN IF NOT EXISTS lock_tx_hash text,
  ADD COLUMN IF NOT EXISTS lock_unlock_at timestamptz,
  ADD COLUMN IF NOT EXISTS lock_permanent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lock_verified_at timestamptz;