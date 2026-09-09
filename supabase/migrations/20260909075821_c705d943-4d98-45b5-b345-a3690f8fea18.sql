-- Token supplies are 18-decimal base-unit integers (e.g. 1,000,000 tokens = 1e24 base units).
-- Postgres `numeric` holds them exactly, but the Data API serialises numeric as a JSON
-- number, so JavaScript receives a lossy double ("1e+24"), which can never be compared
-- against the exact on-chain value. Store them as exact decimal strings instead — the
-- same convention companion_token_offers and liquidity_positions already use.
ALTER TABLE public.companion_tokens
  ALTER COLUMN total_supply TYPE text USING trim(to_char(total_supply, 'FM9999999999999999999999999999999999999999999999999999999999999999999999999999')),
  ALTER COLUMN creator_allocation TYPE text USING trim(to_char(creator_allocation, 'FM9999999999999999999999999999999999999999999999999999999999999999999999999999'));

ALTER TABLE public.companion_tokens
  ADD CONSTRAINT companion_tokens_total_supply_base_units CHECK (total_supply ~ '^[0-9]+$'),
  ADD CONSTRAINT companion_tokens_creator_allocation_base_units CHECK (creator_allocation ~ '^[0-9]+$');