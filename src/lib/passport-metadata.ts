/**
 * Pure helpers shared by the launchpad server functions and their tests.
 * No browser or server-only APIs here.
 */

export type PassportMetadataInput = {
  listingId: string;
  slug: string;
  title: string;
  description: string;
  category: string | null;
  condition: string | null;
  conditionNotes: string | null;
  brand: string | null;
  model: string | null;
  year: number | null;
  dimensions: string | null;
  city: string | null;
  region: string | null;
  priceEth: number | string;
  isFree: boolean;
  termsVersion: string;
  sellerHandle: string;
  images: { url: string; sha256: string }[];
  frozenAt: string;
};

export const PASSPORT_DISCLAIMER =
  "An Item Passport is a record of a listing on YARD SALE. It is not title to the physical item, not a claim on sale proceeds, and carries no financial rights.";

export const COMPANION_TOKEN_DISCLAIMER =
  "A Companion Token grants no ownership, redemption, revenue, dividend, yield, guaranteed value, or legal right to the physical item or its sale proceeds.";

/** Deterministic key-sorted JSON so the same listing always hashes identically. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function buildPassportMetadata(input: PassportMetadataInput) {
  return {
    schema: "yardsale/item-passport/1",
    name: input.title,
    description: input.description,
    external_url: `/item/${input.slug}`,
    image: input.images[0]?.url ?? null,
    images: input.images,
    disclaimer: PASSPORT_DISCLAIMER,
    listing: {
      id: input.listingId,
      slug: input.slug,
      seller_handle: input.sellerHandle,
      terms_version: input.termsVersion,
      frozen_at: input.frozenAt,
    },
    attributes: [
      { trait_type: "Category", value: input.category },
      { trait_type: "Condition", value: input.condition },
      { trait_type: "Condition notes", value: input.conditionNotes },
      { trait_type: "Brand", value: input.brand },
      { trait_type: "Model", value: input.model },
      { trait_type: "Year", value: input.year },
      { trait_type: "Dimensions", value: input.dimensions },
      { trait_type: "City", value: input.city },
      { trait_type: "Region", value: input.region },
      { trait_type: "Price (ETH)", value: input.isFree ? "0" : String(input.priceEth) },
    ].filter((attribute) => attribute.value !== null && attribute.value !== ""),
  };
}

export type EligibilityReason =
  | "ok"
  | "not_published"
  | "no_photos"
  | "no_terms"
  | "demo_listing"
  | "already_minted";

export function passportEligibility(listing: {
  status: string;
  is_demo: boolean;
  terms_version: string | null;
  mediaCount: number;
  hasConfirmedPassport: boolean;
}): { eligible: boolean; reason: EligibilityReason } {
  if (listing.hasConfirmedPassport) return { eligible: false, reason: "already_minted" };
  if (listing.is_demo) return { eligible: false, reason: "demo_listing" };
  if (listing.status !== "published") return { eligible: false, reason: "not_published" };
  if (listing.mediaCount < 1) return { eligible: false, reason: "no_photos" };
  if (!listing.terms_version) return { eligible: false, reason: "no_terms" };
  return { eligible: true, reason: "ok" };
}

export const eligibilityLabel: Record<EligibilityReason, string> = {
  ok: "Ready to mint",
  not_published: "Publish the listing first",
  no_photos: "Add at least one photo",
  no_terms: "Accept the listing terms in the wizard",
  demo_listing: "Demo listings cannot be minted",
  already_minted: "Passport already minted",
};

/** Fixed-supply amounts are entered in whole tokens; the contract stores 18 decimals. */
export function toTokenUnits(whole: string): bigint {
  const trimmed = whole.trim();
  if (!/^\d+$/.test(trimmed)) throw new Error("Enter a whole number of tokens.");
  return BigInt(trimmed) * 10n ** 18n;
}
