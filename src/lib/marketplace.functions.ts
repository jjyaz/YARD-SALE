import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

const PUBLIC_STATUSES = ["published", "reserved", "sold", "redeemed"] as const;

const LISTING_COLUMNS =
  "id, slug, title, description, category, condition, condition_notes, brand, model, year, dimensions, price_eth, is_free, fulfillment_mode, city, region, postal_prefix, availability, pickup_deadline, status, passport_minted, companion_token, is_demo, demo_seller_handle, seller_id, published_at, created_at, terms_version";

function publicClient() {
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  const url = process.env["SUPABASE_URL"]!;
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) {
          h.delete("Authorization");
        }
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

export type PublicListing = {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string | null;
  condition: string | null;
  condition_notes: string | null;
  brand: string | null;
  model: string | null;
  year: number | null;
  dimensions: string | null;
  price_eth: number;
  is_free: boolean;
  fulfillment_mode: string;
  city: string | null;
  region: string | null;
  postal_prefix: string | null;
  availability: string | null;
  pickup_deadline: string | null;
  status: string;
  passport_minted: boolean;
  companion_token: boolean;
  is_demo: boolean;
  demo_seller_handle: string | null;
  seller_id: string | null;
  published_at: string | null;
  created_at: string;
  terms_version: string | null;
  media: { public_url: string | null; ordinal: number; is_cover: boolean }[];
  seller_handle: string | null;
};

type Row = Record<string, unknown>;

function toListing(row: Row): PublicListing {
  const media = ((row["listing_media"] as Row[] | null) ?? []).map((m) => ({
    public_url: (m["public_url"] as string | null) ?? null,
    ordinal: Number(m["ordinal"] ?? 0),
    is_cover: Boolean(m["is_cover"]),
  }));
  const profile = row["profiles"] as Row | null;
  return {
    ...(row as unknown as PublicListing),
    price_eth: Number(row["price_eth"] ?? 0),
    media: media.sort((a, b) => Number(b.is_cover) - Number(a.is_cover) || a.ordinal - b.ordinal),
    seller_handle:
      (profile?.["handle"] as string | undefined) ??
      (row["demo_seller_handle"] as string | null) ??
      null,
  };
}

export const getFeaturedListings = createServerFn({ method: "GET" }).handler(async () => {
  const { data, error } = await publicClient()
    .from("listings")
    .select(`${LISTING_COLUMNS}, listing_media(public_url, ordinal, is_cover), profiles(handle)`)
    .in("status", PUBLIC_STATUSES)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(8);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => toListing(row as Row));
});

export type BrowseInput = {
  q?: string;
  category?: string;
  condition?: string;
  city?: string;
  passport?: string;
  maxPrice?: number;
  sort?: string;
  page?: number;
};

export const browseListings = createServerFn({ method: "GET" })
  .inputValidator((input: BrowseInput) => input ?? {})
  .handler(async ({ data }) => {
    const pageSize = 12;
    const page = Math.max(1, Number(data.page ?? 1));
    let query = publicClient()
      .from("listings")
      .select(
        `${LISTING_COLUMNS}, listing_media(public_url, ordinal, is_cover), profiles(handle)`,
        { count: "exact" },
      )
      .in("status", PUBLIC_STATUSES);

    if (data.q) query = query.ilike("title", `%${data.q}%`);
    if (data.category) query = query.eq("category", data.category);
    if (data.condition) query = query.eq("condition", data.condition);
    if (data.city) query = query.ilike("city", `%${data.city}%`);
    if (data.passport === "minted") query = query.eq("passport_minted", true);
    if (data.passport === "token") query = query.eq("companion_token", true);
    if (typeof data.maxPrice === "number" && data.maxPrice > 0) {
      query = query.lte("price_eth", data.maxPrice);
    }

    switch (data.sort) {
      case "price_asc":
        query = query.order("price_eth", { ascending: true });
        break;
      case "price_desc":
        query = query.order("price_eth", { ascending: false });
        break;
      default:
        query = query.order("published_at", { ascending: false, nullsFirst: false });
    }

    const from = (page - 1) * pageSize;
    const { data: rows, count, error } = await query.range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    return {
      items: (rows ?? []).map((row) => toListing(row as Row)),
      total: count ?? 0,
      page,
      pageSize,
    };
  });

export const getListingBySlug = createServerFn({ method: "GET" })
  .inputValidator((input: { slug: string }) => input)
  .handler(async ({ data }) => {
    const client = publicClient();
    const { data: row, error } = await client
      .from("listings")
      .select(`${LISTING_COLUMNS}, listing_media(public_url, ordinal, is_cover), profiles(handle)`)
      .eq("slug", data.slug)
      .in("status", PUBLIC_STATUSES)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return null;
    const listing = toListing(row as Row);

    const { data: related } = await client
      .from("listings")
      .select(`${LISTING_COLUMNS}, listing_media(public_url, ordinal, is_cover), profiles(handle)`)
      .in("status", PUBLIC_STATUSES)
      .eq("category", listing.category ?? "other")
      .neq("slug", listing.slug)
      .limit(3);

    return { listing, related: (related ?? []).map((r) => toListing(r as Row)) };
  });

export const getPublicProfile = createServerFn({ method: "GET" })
  .inputValidator((input: { handle: string }) => input)
  .handler(async ({ data }) => {
    const client = publicClient();
    const { data: profile } = await client
      .from("profiles")
      .select("id, handle, display_name, bio, city, region, listings_sold, listings_published, created_at")
      .eq("handle", data.handle)
      .maybeSingle();

    if (!profile) {
      // Demo sellers exist only as a handle on their listings.
      const { data: demoRows } = await client
        .from("listings")
        .select(`${LISTING_COLUMNS}, listing_media(public_url, ordinal, is_cover), profiles(handle)`)
        .eq("demo_seller_handle", data.handle)
        .in("status", PUBLIC_STATUSES);
      if (!demoRows || demoRows.length === 0) return null;
      const items = demoRows.map((r) => toListing(r as Row));
      return {
        profile: {
          id: null,
          handle: data.handle,
          display_name: data.handle,
          bio: "Demo seller included with the YARD SALE preview data.",
          city: items[0]?.city ?? null,
          region: items[0]?.region ?? null,
          listings_sold: 0,
          listings_published: items.length,
          created_at: items[0]?.created_at ?? new Date().toISOString(),
          is_demo: true,
        },
        listings: items,
      };
    }

    const { data: rows } = await client
      .from("listings")
      .select(`${LISTING_COLUMNS}, listing_media(public_url, ordinal, is_cover), profiles(handle)`)
      .eq("seller_id", profile.id)
      .in("status", PUBLIC_STATUSES)
      .order("published_at", { ascending: false, nullsFirst: false });

    return {
      profile: { ...profile, is_demo: false },
      listings: (rows ?? []).map((r) => toListing(r as Row)),
    };
  });
