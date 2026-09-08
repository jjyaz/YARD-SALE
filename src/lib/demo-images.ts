import wideYard from "@/assets/yard-wide.jpg";
import photographing from "@/assets/yard-photograph.jpg";
import porchPickup from "@/assets/yard-pickup.jpg";

export const yardImages = { wideYard, photographing, porchPickup };

const rotation = [wideYard, photographing, porchPickup];

/** Deterministic stand-in photo for the bundled demo listings. */
export function demoCover(slug: string): string {
  let sum = 0;
  for (const char of slug) sum += char.charCodeAt(0);
  return rotation[sum % rotation.length];
}

export function coverFor(listing: {
  slug: string;
  is_demo: boolean;
  media: { public_url: string | null }[];
}): string {
  const real = listing.media.find((m) => m.public_url)?.public_url;
  if (real) return real;
  return demoCover(listing.slug);
}
