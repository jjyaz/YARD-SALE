
-- ENUMS
CREATE TYPE public.app_role AS ENUM ('user','moderator','admin');
CREATE TYPE public.listing_status AS ENUM ('draft','published','reserved','sold','redeemed','removed');
CREATE TYPE public.listing_category AS ENUM ('furniture','electronics','collectibles','tools','home_garden','clothing','toys_games','music','sports','free_stuff','other');
CREATE TYPE public.listing_condition AS ENUM ('new_unused','like_new','good','fair','for_parts');
CREATE TYPE public.fulfillment_mode AS ENUM ('reserve_only','onchain_escrow');
CREATE TYPE public.media_moderation_state AS ENUM ('pending','approved','flagged','removed');
CREATE TYPE public.report_reason AS ENUM ('stolen','prohibited','counterfeit','unsafe_meetup','spam','other');
CREATE TYPE public.report_status AS ENUM ('open','reviewing','actioned','dismissed');

-- SHARED TRIGGER FN
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- PROFILES
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  handle TEXT NOT NULL UNIQUE,
  display_name TEXT,
  bio TEXT,
  avatar_path TEXT,
  city TEXT,
  region TEXT,
  listings_sold INTEGER NOT NULL DEFAULT 0,
  listings_published INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.profiles TO anon;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_public_read" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "profiles_owner_insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_owner_update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ROLES
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE POLICY "user_roles_self_read" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "user_roles_admin_write" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- NEW USER TRIGGER
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE base TEXT; candidate TEXT; n INT := 0;
BEGIN
  base := regexp_replace(lower(coalesce(split_part(NEW.email,'@',1),'yardie')), '[^a-z0-9_]', '', 'g');
  IF length(base) < 3 THEN base := 'yardie'; END IF;
  candidate := left(base, 24);
  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE handle = candidate) LOOP
    n := n + 1; candidate := left(base, 20) || n::text;
  END LOOP;
  INSERT INTO public.profiles (id, handle, display_name) VALUES (NEW.id, candidate, candidate);
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user') ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- WALLETS
CREATE TABLE public.wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  address TEXT NOT NULL UNIQUE CHECK (address = lower(address) AND address ~ '^0x[0-9a-f]{40}$'),
  chain_id INTEGER NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);
GRANT SELECT, INSERT, DELETE ON public.wallets TO authenticated;
GRANT ALL ON public.wallets TO service_role;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wallets_owner_read" ON public.wallets FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "wallets_owner_delete" ON public.wallets FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- WALLET NONCES (server-only)
CREATE TABLE public.wallet_nonces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  nonce_hash TEXT NOT NULL UNIQUE,
  address TEXT,
  domain TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.wallet_nonces TO service_role;
ALTER TABLE public.wallet_nonces ENABLE ROW LEVEL SECURITY;

-- TERMS VERSIONS
CREATE TABLE public.terms_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version TEXT NOT NULL UNIQUE,
  body TEXT NOT NULL,
  terms_hash TEXT NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.terms_versions TO anon, authenticated;
GRANT ALL ON public.terms_versions TO service_role;
ALTER TABLE public.terms_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "terms_public_read" ON public.terms_versions FOR SELECT USING (true);

-- LISTINGS
CREATE TABLE public.listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID REFERENCES auth.users ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  status public.listing_status NOT NULL DEFAULT 'draft',
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  category public.listing_category,
  condition public.listing_condition,
  condition_notes TEXT,
  brand TEXT,
  model TEXT,
  year INTEGER,
  dimensions TEXT,
  price_wei NUMERIC(78,0) NOT NULL DEFAULT 0,
  price_eth NUMERIC(30,18) NOT NULL DEFAULT 0,
  is_free BOOLEAN NOT NULL DEFAULT false,
  fulfillment_mode public.fulfillment_mode NOT NULL DEFAULT 'reserve_only',
  city TEXT,
  region TEXT,
  postal_prefix TEXT,
  availability TEXT,
  pickup_deadline DATE,
  possession_code_hash TEXT,
  accuracy_confirmed BOOLEAN NOT NULL DEFAULT false,
  attestation_accepted BOOLEAN NOT NULL DEFAULT false,
  terms_version TEXT,
  wizard_step SMALLINT NOT NULL DEFAULT 1,
  passport_minted BOOLEAN NOT NULL DEFAULT false,
  companion_token BOOLEAN NOT NULL DEFAULT false,
  is_demo BOOLEAN NOT NULL DEFAULT false,
  demo_seller_handle TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX listings_browse_idx ON public.listings (status, published_at DESC);
CREATE INDEX listings_category_idx ON public.listings (category);
CREATE INDEX listings_price_idx ON public.listings (price_eth);
CREATE INDEX listings_seller_idx ON public.listings (seller_id);
GRANT SELECT ON public.listings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.listings TO authenticated;
GRANT ALL ON public.listings TO service_role;
ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "listings_public_read" ON public.listings FOR SELECT USING (status IN ('published','reserved','sold','redeemed'));
CREATE POLICY "listings_owner_read" ON public.listings FOR SELECT TO authenticated USING (auth.uid() = seller_id);
CREATE POLICY "listings_owner_insert" ON public.listings FOR INSERT TO authenticated WITH CHECK (auth.uid() = seller_id);
CREATE POLICY "listings_owner_update" ON public.listings FOR UPDATE TO authenticated USING (auth.uid() = seller_id) WITH CHECK (auth.uid() = seller_id);
CREATE POLICY "listings_owner_delete" ON public.listings FOR DELETE TO authenticated USING (auth.uid() = seller_id AND status = 'draft');
CREATE POLICY "listings_moderator_read" ON public.listings FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'moderator') OR public.has_role(auth.uid(),'admin'));
CREATE TRIGGER listings_updated_at BEFORE UPDATE ON public.listings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- LISTING MEDIA
CREATE TABLE public.listing_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES public.listings ON DELETE CASCADE,
  storage_path TEXT,
  public_url TEXT,
  content_hash TEXT,
  width INTEGER,
  height INTEGER,
  ordinal SMALLINT NOT NULL DEFAULT 0,
  is_cover BOOLEAN NOT NULL DEFAULT false,
  moderation_state public.media_moderation_state NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX listing_media_listing_idx ON public.listing_media (listing_id, ordinal);
GRANT SELECT ON public.listing_media TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.listing_media TO authenticated;
GRANT ALL ON public.listing_media TO service_role;
ALTER TABLE public.listing_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY "listing_media_public_read" ON public.listing_media FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.listings l WHERE l.id = listing_id AND l.status IN ('published','reserved','sold','redeemed'))
);
CREATE POLICY "listing_media_owner_all" ON public.listing_media FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.listings l WHERE l.id = listing_id AND l.seller_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.listings l WHERE l.id = listing_id AND l.seller_id = auth.uid()));

-- PRIVATE PICKUP DETAILS
CREATE TABLE public.private_pickup_details (
  listing_id UUID PRIMARY KEY REFERENCES public.listings ON DELETE CASCADE,
  seller_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  exact_address TEXT,
  instructions TEXT,
  contact_note TEXT,
  reveal_policy TEXT NOT NULL DEFAULT 'on_funded_order',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.private_pickup_details TO authenticated;
GRANT ALL ON public.private_pickup_details TO service_role;
ALTER TABLE public.private_pickup_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pickup_owner_all" ON public.private_pickup_details FOR ALL TO authenticated USING (auth.uid() = seller_id) WITH CHECK (auth.uid() = seller_id);
CREATE TRIGGER pickup_updated_at BEFORE UPDATE ON public.private_pickup_details FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- FAVORITES
CREATE TABLE public.favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES public.listings ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, listing_id)
);
GRANT SELECT, INSERT, DELETE ON public.favorites TO authenticated;
GRANT ALL ON public.favorites TO service_role;
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "favorites_owner_all" ON public.favorites FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- REPORTS
CREATE TABLE public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID REFERENCES auth.users ON DELETE SET NULL,
  listing_id UUID REFERENCES public.listings ON DELETE CASCADE,
  reason public.report_reason NOT NULL,
  details TEXT,
  status public.report_status NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.reports TO authenticated;
GRANT UPDATE ON public.reports TO authenticated;
GRANT ALL ON public.reports TO service_role;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reports_author_read" ON public.reports FOR SELECT TO authenticated USING (auth.uid() = reporter_id OR public.has_role(auth.uid(),'moderator') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "reports_author_insert" ON public.reports FOR INSERT TO authenticated WITH CHECK (auth.uid() = reporter_id);
CREATE POLICY "reports_moderator_update" ON public.reports FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'moderator') OR public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'moderator') OR public.has_role(auth.uid(),'admin'));
CREATE TRIGGER reports_updated_at BEFORE UPDATE ON public.reports FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- MODERATION ACTIONS
CREATE TABLE public.moderation_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  moderator_id UUID REFERENCES auth.users ON DELETE SET NULL,
  listing_id UUID REFERENCES public.listings ON DELETE CASCADE,
  report_id UUID REFERENCES public.reports ON DELETE SET NULL,
  action TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.moderation_actions TO authenticated;
GRANT ALL ON public.moderation_actions TO service_role;
ALTER TABLE public.moderation_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "moderation_admin_read" ON public.moderation_actions FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'moderator') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "moderation_admin_insert" ON public.moderation_actions FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(),'moderator') OR public.has_role(auth.uid(),'admin')) AND auth.uid() = moderator_id);

-- NOTIFICATIONS
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  href TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notifications_owner_read" ON public.notifications FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "notifications_owner_update" ON public.notifications FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- TERMS SEED
INSERT INTO public.terms_versions (version, body, terms_hash) VALUES
('2026-09-01', 'YARD SALE listing and pickup terms, version 2026-09-01. Local pickup only. Sellers must own or be authorized to sell the item. Item Passports are records and contractual claim rights, not government title.', '0x0000000000000000000000000000000000000000000000000000000000000001');

-- DEMO LISTINGS
INSERT INTO public.listings (slug, status, title, description, category, condition, condition_notes, price_eth, price_wei, is_free, fulfillment_mode, city, region, postal_prefix, availability, is_demo, demo_seller_handle, published_at)
VALUES
('demo-teak-side-table','published','Teak side table','A solid teak side table from a 1960s living room set. Warm grain, one small water ring on the top that a coaster hides completely.','furniture','good','Small water ring on top surface.',0.014,14000000000000000,false,'reserve_only','Portland','OR','972','Weekends, 10am-4pm',true,'demo_maple_street','2026-09-01'),
('demo-vintage-desk-lamp','published','Vintage brass desk lamp','Heavy brass desk lamp, rewired last year with a new cord and switch. Throws a lovely warm pool of light.','home_garden','like_new','Rewired 2025, new cord.',0.009,9000000000000000,false,'reserve_only','Portland','OR','972','Weekday evenings',true,'demo_maple_street','2026-09-02'),
('demo-record-player','published','Record player, belt drive','Belt-drive turntable that still spins true. Belt replaced this spring. Dust cover has light scratches.','music','good','New belt, scratched dust cover.',0.045,45000000000000000,false,'reserve_only','Austin','TX','787','Saturdays',true,'demo_oak_lane','2026-09-02'),
('demo-box-of-vinyl','published','Box of vinyl, mostly soul','About forty records, mostly soul and a little jazz. Sleeves are worn, the vinyl mostly plays clean.','music','fair','Worn sleeves, a few surface scratches.',0.02,20000000000000000,false,'reserve_only','Austin','TX','787','Weekends',true,'demo_oak_lane','2026-09-03'),
('demo-garden-tools','published','Garden tool bundle','Spade, fork, hand trowel and shears. Handles are worn smooth from real use, all still sharp.','tools','good','Surface rust on the shears.',0.006,6000000000000000,false,'reserve_only','Denver','CO','802','Any afternoon',true,'demo_cedar_court','2026-09-03'),
('demo-bicycle','published','Steel commuter bicycle','A steel-framed commuter, 54cm. New tyres, brakes recently trued. Rides quietly.','sports','good','Paint chips on the top tube.',0.06,60000000000000000,false,'reserve_only','Denver','CO','802','Weekday mornings',true,'demo_cedar_court','2026-09-04'),
('demo-ceramic-planter','published','Large ceramic planter','Hand-thrown planter, glazed in a soft speckled cream. Drainage hole, no cracks.','home_garden','like_new','No chips or cracks.',0.008,8000000000000000,false,'reserve_only','Seattle','WA','981','Weekends',true,'demo_birch_way','2026-09-04'),
('demo-film-camera','published','35mm film camera','A working 35mm SLR with a 50mm lens. Light seals replaced, meter reads accurately.','electronics','good','New light seals, small dent on the base plate.',0.035,35000000000000000,false,'reserve_only','Seattle','WA','981','Evenings',true,'demo_birch_way','2026-09-05'),
('demo-wooden-chair','published','Wooden dining chair','Single spindle-back dining chair in oak. Joints are tight, seat has an honest patina.','furniture','fair','One repaired spindle.',0.005,5000000000000000,false,'reserve_only','Chicago','IL','606','Weekends',true,'demo_walnut_row','2026-09-05'),
('demo-moving-boxes','published','Free moving boxes','Fifteen sturdy moving boxes, folded flat, plus a half roll of tape. Free to whoever hauls them away.','free_stuff','good','Folded flat, a few soft corners.',0,0,true,'reserve_only','Chicago','IL','606','Any day this week',true,'demo_walnut_row','2026-09-06');
