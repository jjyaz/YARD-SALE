import { Link } from "@tanstack/react-router";

import { coverFor } from "@/lib/demo-images";
import { approxFiat, conditionLabel, formatEth } from "@/lib/listing-meta";
import type { PublicListing } from "@/lib/marketplace.functions";

export function StatusChip({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "grass" | "warning";
}) {
  const tones = {
    neutral: "border-border bg-secondary text-foreground",
    grass: "border-grass-deep/30 bg-grass/25 text-foreground",
    warning: "border-warning/40 bg-warning/10 text-warning",
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function ListingCard({
  listing,
  eager = false,
}: {
  listing: PublicListing;
  eager?: boolean;
}) {
  const fiat = approxFiat(listing.price_eth, listing.is_free);
  return (
    <article className="group overflow-hidden rounded-xl border border-border bg-card transition-shadow duration-200 hover:shadow-float">
      <Link to="/item/$slug" params={{ slug: listing.slug }} className="block">
        <div className="aspect-[4/3] overflow-hidden bg-secondary">
          <img
            src={coverFor(listing)}
            alt={listing.title}
            width={800}
            height={600}
            loading={eager ? "eager" : "lazy"}
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
          />
        </div>
        <div className="space-y-2 p-4">
          <div className="flex flex-wrap gap-1.5">
            {listing.passport_minted ? <StatusChip tone="grass">Passport minted</StatusChip> : null}
            {listing.companion_token ? <StatusChip>Token paired</StatusChip> : null}
            {listing.status === "reserved" ? (
              <StatusChip tone="warning">Reserved</StatusChip>
            ) : null}
            {listing.status === "redeemed" ? <StatusChip>Redeemed</StatusChip> : null}
            {listing.is_demo ? <StatusChip>Demo listing</StatusChip> : null}
          </div>
          <h3 className="text-base font-bold leading-snug">{listing.title}</h3>
          <p className="text-sm text-muted-foreground">
            {conditionLabel(listing.condition)}
            {listing.city ? ` • ${listing.city}${listing.region ? `, ${listing.region}` : ""}` : ""}
          </p>
          <div className="flex items-baseline justify-between pt-1">
            <p className="font-mono text-sm font-semibold">
              {formatEth(listing.price_eth, listing.is_free)}
            </p>
            {fiat ? <p className="text-xs text-muted-foreground">{fiat}</p> : null}
          </div>
          {listing.seller_handle ? (
            <p className="text-xs text-muted-foreground">by @{listing.seller_handle}</p>
          ) : null}
        </div>
      </Link>
    </article>
  );
}
