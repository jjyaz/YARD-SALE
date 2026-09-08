import wideYard from "@/assets/yard-wide.jpg";
import photographing from "@/assets/yard-photograph.jpg";
import porchPickup from "@/assets/yard-pickup.jpg";
import teakSideTable from "@/assets/demo/teak-side-table.jpg";
import deskLamp from "@/assets/demo/desk-lamp.jpg";
import recordPlayer from "@/assets/demo/record-player.jpg";
import vinylBox from "@/assets/demo/vinyl-box.jpg";
import gardenTools from "@/assets/demo/garden-tools.jpg";
import bicycle from "@/assets/demo/bicycle.jpg";
import ceramicPlanter from "@/assets/demo/ceramic-planter.jpg";
import filmCamera from "@/assets/demo/film-camera.jpg";
import woodenChair from "@/assets/demo/wooden-chair.jpg";
import movingBoxes from "@/assets/demo/moving-boxes.jpg";

export const yardImages = { wideYard, photographing, porchPickup };

/** One distinct photo per bundled demo listing. */
const bySlug: Record<string, string> = {
  "demo-teak-side-table": teakSideTable,
  "demo-vintage-desk-lamp": deskLamp,
  "demo-record-player": recordPlayer,
  "demo-box-of-vinyl": vinylBox,
  "demo-garden-tools": gardenTools,
  "demo-bicycle": bicycle,
  "demo-ceramic-planter": ceramicPlanter,
  "demo-film-camera": filmCamera,
  "demo-wooden-chair": woodenChair,
  "demo-moving-boxes": movingBoxes,
};

const rotation = [
  teakSideTable,
  deskLamp,
  recordPlayer,
  vinylBox,
  gardenTools,
  bicycle,
  ceramicPlanter,
  filmCamera,
  woodenChair,
  movingBoxes,
  wideYard,
  photographing,
  porchPickup,
];

/** Deterministic stand-in photo for the bundled demo listings. */
export function demoCover(slug: string): string {
  const exact = bySlug[slug];
  if (exact) return exact;
  let sum = 0;
  for (const char of slug) sum += char.charCodeAt(0);
  return rotation[sum % rotation.length] ?? wideYard;
}

/** A secondary photo that is never the same as the listing's cover. */
export function demoSecondary(slug: string): string {
  const cover = demoCover(slug);
  const others = rotation.filter((src) => src !== cover);
  let sum = 0;
  for (const char of slug) sum += char.charCodeAt(0);
  return others[sum % others.length] ?? wideYard;
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
