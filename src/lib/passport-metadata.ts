/**
 * Pure helpers shared by the launchpad server functions and their tests.
 * No browser or server-only APIs here.
 */

export type PossessionAttestation = {
  /** I physically possess this item today. */
  possession: boolean;
  /** I own it or am authorised to sell it. */
  rightToSell: boolean;
  /** The photos and description are accurate and unedited. */
  accurate: boolean;
  /** It is not a prohibited item. */
  notProhibited: boolean;
  /** I understand the passport is a record, not title or a financial right. */
  understandsNoRights: boolean;
};

export const ATTESTATION_STATEMENTS: { key: keyof PossessionAttestation; text: string }[] = [
  { key: "possession", text: "I physically possess this item today and can hand it over at pickup." },
  { key: "rightToSell", text: "I own this item or am authorised by its owner to sell it." },
  { key: "accurate", text: "The photos and description are accurate and have not been edited to hide damage." },
  { key: "notProhibited", text: "It is not a prohibited, stolen, recalled or counterfeit item." },
  {
    key: "understandsNoRights",
    text: "I understand an Item Passport is a permanent record of this listing, not title to the item and not a financial instrument.",
  },
];

export function attestationComplete(a: Partial<PossessionAttestation> | null | undefined): a is PossessionAttestation {
  return Boolean(a) && ATTESTATION_STATEMENTS.every((s) => a?.[s.key] === true);
}

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
  termsHash: string;
  sellerHandle: string;
  images: { url: string; sha256: string }[];
  frozenAt: string;
  chainId: number;
  registry: string;
  attestation: PossessionAttestation;
  attestedAt: string;
};

export const PASSPORT_DISCLAIMER =
  "An Item Passport is a record of a listing on YARD SALE. It is not title to the physical item, not a claim on sale proceeds, and carries no financial rights.";

export const COMPANION_TOKEN_DISCLAIMER =
  "A Companion Token grants no ownership, redemption, revenue, dividend, yield, guaranteed value, investment return, or legal right to the physical item or its sale proceeds. It can lose all of its value.";

export const LIQUIDITY_RISK_STATEMENTS = [
  "The ratio of tokens to ETH I deposit sets the opening price. Nobody appraised anything; this number is mine.",
  "Providing liquidity can lose value against simply holding, and the token can go to zero.",
  "The pool price is not an appraisal, valuation or promise about the physical item.",
  "Anyone can trade against this pool at any time; I cannot pause, tax or reverse trades.",
  "Liquidity is not locked by this step. The position NFT stays in my wallet and I am responsible for it.",
] as const;

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
    schema: "yardsale/item-passport/2",
    name: input.title,
    description: input.description,
    external_url: `/item/${input.slug}`,
    image: input.images[0]?.url ?? null,
    images: input.images,
    disclaimer: PASSPORT_DISCLAIMER,
    chain: { id: input.chainId, registry: input.registry.toLowerCase() },
    listing: {
      id: input.listingId,
      slug: input.slug,
      seller_handle: input.sellerHandle,
      terms_version: input.termsVersion,
      terms_hash: input.termsHash.toLowerCase(),
      frozen_at: input.frozenAt,
    },
    attestation: {
      ...input.attestation,
      statements: ATTESTATION_STATEMENTS.map((s) => s.text),
      attested_at: input.attestedAt,
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

/** Whole-token display for an 18-decimal base-unit string. */
export function fromTokenUnits(units: string | number | bigint): string {
  const value = BigInt(String(units));
  const whole = value / 10n ** 18n;
  const rest = value % 10n ** 18n;
  if (rest === 0n) return whole.toString();
  return `${whole}.${rest.toString().padStart(18, "0").replace(/0+$/, "")}`;
}

/** Mirrors YardCompanionToken.MAX_SUPPLY (1e12 whole tokens). */
export const COMPANION_MAX_SUPPLY = 1_000_000_000_000n * 10n ** 18n;

export function validateTokenParams(input: {
  name: string;
  symbol: string;
  totalSupply: bigint;
  creatorAllocation: bigint;
}): string | null {
  if (!input.name.trim()) return "Token name is required.";
  if (input.name.trim().length > 64) return "Token name must be 64 characters or fewer.";
  if (!input.symbol.trim()) return "Token symbol is required.";
  if (input.symbol.trim().length > 16) return "Token symbol must be 16 characters or fewer.";
  if (input.totalSupply <= 0n) return "Total supply must be greater than zero.";
  if (input.totalSupply > COMPANION_MAX_SUPPLY) return "Total supply exceeds the contract maximum of 1,000,000,000,000 tokens.";
  if (input.creatorAllocation <= 0n) return "Your allocation must be greater than zero.";
  if (input.creatorAllocation > input.totalSupply) return "Your allocation cannot exceed the total supply.";
  return null;
}
