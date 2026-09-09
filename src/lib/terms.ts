import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

export type CurrentTerms = {
  version: string;
  body: string;
  terms_hash: string;
  effective_from: string;
};

/**
 * Resolves the terms version that is in force right now — the newest row whose
 * `effective_from` is in the past. Listings must be stamped with a version that
 * really exists in `terms_versions`, otherwise the Item Passport terms hash can
 * never be computed and the listing can never be minted.
 */
export async function fetchCurrentTerms(db: SupabaseClient<Database>): Promise<CurrentTerms> {
  const { data, error } = await db
    .from("terms_versions")
    .select("version, body, terms_hash, effective_from")
    .lte("effective_from", new Date().toISOString())
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not load the current terms of use: ${error.message}`);
  if (!data) throw new Error("No terms of use are in force yet, so listings cannot be published.");
  return data;
}
