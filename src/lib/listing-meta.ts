export const CATEGORIES = [
  { value: "furniture", label: "Furniture" },
  { value: "electronics", label: "Electronics" },
  { value: "collectibles", label: "Collectibles" },
  { value: "tools", label: "Tools" },
  { value: "home_garden", label: "Home & Garden" },
  { value: "clothing", label: "Clothing" },
  { value: "toys_games", label: "Toys & Games" },
  { value: "music", label: "Music" },
  { value: "sports", label: "Sports" },
  { value: "free_stuff", label: "Free Stuff" },
  { value: "other", label: "Other" },
] as const;

export const CONDITIONS = [
  { value: "new_unused", label: "New / unused" },
  { value: "like_new", label: "Like new" },
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
  { value: "for_parts", label: "For parts / repair" },
] as const;

export type CategoryValue = (typeof CATEGORIES)[number]["value"];
export type ConditionValue = (typeof CONDITIONS)[number]["value"];

export function categoryLabel(value: string | null | undefined): string {
  return CATEGORIES.find((c) => c.value === value)?.label ?? "Uncategorised";
}

export function conditionLabel(value: string | null | undefined): string {
  return CONDITIONS.find((c) => c.value === value)?.label ?? "Condition not stated";
}

/** Approximate fiat estimate, clearly labelled as approximate wherever shown. */
export const ETH_FIAT_ESTIMATE_USD = 3200;

export function formatEth(priceEth: number | string, isFree = false): string {
  if (isFree) return "Free";
  const value = typeof priceEth === "string" ? Number(priceEth) : priceEth;
  if (!Number.isFinite(value) || value === 0) return "Free";
  return `${value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")} ETH`;
}

export function approxFiat(priceEth: number | string, isFree = false): string | null {
  if (isFree) return null;
  const value = typeof priceEth === "string" ? Number(priceEth) : priceEth;
  if (!Number.isFinite(value) || value === 0) return null;
  return `≈ $${Math.round(value * ETH_FIAT_ESTIMATE_USD).toLocaleString("en-US")} (approx.)`;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
