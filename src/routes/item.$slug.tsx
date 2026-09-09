import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ConfigRequired } from "@/components/site/ConfigRequired";
import { ListingCard, StatusChip } from "@/components/site/ListingCard";
import { ReportDialog } from "@/components/site/ReportDialog";
import { FavoriteButton } from "@/components/site/FavoriteButton";
import { Button } from "@/components/ui/button";
import { coverFor, demoSecondary } from "@/lib/demo-images";
import { approxFiat, categoryLabel, conditionLabel, formatEth } from "@/lib/listing-meta";
import { getListingBySlug } from "@/lib/marketplace.functions";

const listingQuery = (slug: string) =>
  queryOptions({
    queryKey: ["listing", slug],
    queryFn: () => getListingBySlug({ data: { slug } }),
  });

export const Route = createFileRoute("/item/$slug")({
  loader: async ({ context, params }) => {
    const result = await context.queryClient.ensureQueryData(listingQuery(params.slug));
    if (!result) throw notFound();
    return result;
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return {
        meta: [
          { title: "Listing unavailable — YARD SALE" },
          { name: "robots", content: "noindex" },
        ],
      };
    }
    const { listing } = loaderData;
    const title = `${listing.title} — ${formatEth(listing.price_eth, listing.is_free)} — YARD SALE`;
    const description = listing.description.slice(0, 155);
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: `${listing.title} — YARD SALE` },
        { property: "og:description", content: description },
      ],
    };
  },
  component: ItemDetail,
});

function ItemDetail() {
  const { slug } = Route.useParams();
  const { data } = useSuspenseQuery(listingQuery(slug));
  const [activeIndex, setActiveIndex] = useState(0);

  if (!data) return null;
  const { listing, related } = data;

  const gallery =
    listing.media.filter((m) => m.public_url).map((m) => m.public_url as string).length > 0
      ? listing.media.filter((m) => m.public_url).map((m) => m.public_url as string)
      : [coverFor(listing), demoSecondary(listing.slug)];

  const fiat = approxFiat(listing.price_eth, listing.is_free);
  const soldOrGone = listing.status === "sold" || listing.status === "redeemed";

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-10">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link to="/browse" className="underline underline-offset-4">
          Browse
        </Link>
        <span aria-hidden="true"> / </span>
        <Link
          to="/browse"
          search={{ category: listing.category ?? undefined }}
          className="underline underline-offset-4"
        >
          {categoryLabel(listing.category)}
        </Link>
      </nav>

      <div className="mt-6 grid gap-10 lg:grid-cols-[1.15fr_1fr]">
        <div>
          <div className="overflow-hidden rounded-2xl border border-border bg-secondary">
            <img
              src={gallery[activeIndex] ?? gallery[0]}
              alt={`${listing.title} — photo ${activeIndex + 1}`}
              width={1200}
              height={900}
              className="aspect-[4/3] w-full object-cover"
            />
          </div>
          {gallery.length > 1 ? (
            <div className="mt-3 flex gap-3">
              {gallery.map((src, index) => (
                <button
                  key={src + index}
                  type="button"
                  onClick={() => setActiveIndex(index)}
                  aria-label={`Show photo ${index + 1}`}
                  aria-current={index === activeIndex}
                  className={`h-20 w-24 overflow-hidden rounded-lg border-2 ${
                    index === activeIndex ? "border-grass-deep" : "border-border"
                  }`}
                >
                  <img
                    src={src}
                    alt=""
                    width={200}
                    height={160}
                    className="h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
          ) : null}
          {listing.is_demo ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Demo listing included with the preview data. Photos are illustrative stock imagery.
            </p>
          ) : null}
        </div>

        <div className="space-y-6">
          <div className="flex flex-wrap gap-2">
            {listing.passport_minted ? <StatusChip tone="grass">Passport minted</StatusChip> : null}
            {listing.companion_token ? <StatusChip>Companion token</StatusChip> : null}
            {listing.status === "reserved" ? (
              <StatusChip tone="warning">Reserved</StatusChip>
            ) : null}
            {soldOrGone ? <StatusChip>Gone</StatusChip> : null}
            {listing.is_demo ? <StatusChip>Demo listing</StatusChip> : null}
          </div>

          <div>
            <h1 className="text-3xl font-extrabold sm:text-4xl">{listing.title}</h1>
            <p className="mt-3 font-mono text-2xl font-semibold">
              {formatEth(listing.price_eth, listing.is_free)}
            </p>
            {fiat ? <p className="text-sm text-muted-foreground">{fiat}</p> : null}
          </div>

          <dl className="grid grid-cols-2 gap-4 rounded-xl border border-border bg-card p-5 text-sm">
            <div>
              <dt className="text-muted-foreground">Condition</dt>
              <dd className="font-semibold">{conditionLabel(listing.condition)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Category</dt>
              <dd className="font-semibold">{categoryLabel(listing.category)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Pickup area</dt>
              <dd className="font-semibold">
                {[listing.city, listing.region].filter(Boolean).join(", ") || "Not stated"}
                {listing.postal_prefix ? ` (${listing.postal_prefix})` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Availability</dt>
              <dd className="font-semibold">{listing.availability || "Ask the seller"}</dd>
            </div>
            {listing.brand ? (
              <div>
                <dt className="text-muted-foreground">Brand</dt>
                <dd className="font-semibold">{listing.brand}</dd>
              </div>
            ) : null}
            {listing.dimensions ? (
              <div>
                <dt className="text-muted-foreground">Dimensions</dt>
                <dd className="font-semibold">{listing.dimensions}</dd>
              </div>
            ) : null}
          </dl>

          <div className="prose-measure space-y-3 text-[15px] leading-relaxed">
            <h2 className="text-lg font-bold">About this item</h2>
            <p className="whitespace-pre-line text-muted-foreground">{listing.description}</p>
            {listing.condition_notes ? (
              <p className="whitespace-pre-line text-muted-foreground">{listing.condition_notes}</p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <FavoriteButton listingId={listing.id} />
            <ReportDialog listingId={listing.id} />
            {listing.seller_handle ? (
              <Link
                to="/profile/$handle"
                params={{ handle: listing.seller_handle }}
                className="text-sm font-semibold underline underline-offset-4"
              >
                More from @{listing.seller_handle}
              </Link>
            ) : null}
          </div>

          <ConfigRequired
            title="On-chain actions are switched off"
            reason="Reserving with escrow, minting an Item Passport and companion tokens all require deployed, audited contracts. No contract addresses are configured, so these buttons are not shown rather than faked."
          />

          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-base font-bold">Arranging pickup</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Contact the seller to agree a public meeting place. The exact address is private and
              is only shared by the seller once you have both agreed. Inspect the item before you
              pay — everything here is sold as-is.
            </p>
            <Button asChild variant="outline" className="mt-4">
              <Link to="/trust-safety">Read the safety guidance</Link>
            </Button>
          </div>
        </div>
      </div>

      {related.length > 0 ? (
        <section className="mt-16">
          <h2 className="text-2xl font-extrabold">More like this</h2>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((item) => (
              <ListingCard key={item.id} listing={item} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
