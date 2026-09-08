import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { ArrowRight, Camera, HandCoins, MapPin, ShieldCheck } from "lucide-react";

import logo from "@/assets/yard-sale-official-lockup.png.asset.json";
import banner from "@/assets/yard-sale-banner.png.asset.json";
import { yardImages } from "@/lib/demo-images";
import { ListingCard } from "@/components/site/ListingCard";
import { Button } from "@/components/ui/button";
import { getFeaturedListings } from "@/lib/marketplace.functions";
import { CATEGORIES } from "@/lib/listing-meta";

const featuredQuery = queryOptions({
  queryKey: ["listings", "featured"],
  queryFn: () => getFeaturedListings(),
});

export const Route = createFileRoute("/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(featuredQuery),
  head: () => ({
    meta: [
      { title: "YARD SALE — Your Junk Deserves To Be On-Chain" },
      {
        name: "description",
        content:
          "Sell the couch, keep the story. A neighbourhood marketplace for real second-hand things, with optional Item Passports on Robinhood Chain.",
      },
      { property: "og:title", content: "YARD SALE — Your Junk Deserves To Be On-Chain" },
      {
        property: "og:description",
        content: "A neighbourhood marketplace for real second-hand things, with optional on-chain Item Passports.",
      },
    ],
  }),
  component: Home,
});

const steps = [
  {
    icon: Camera,
    title: "Photograph the thing",
    body: "Honest photos, honest condition. Scratches included — buyers trust the dent more than the adjective.",
  },
  {
    icon: MapPin,
    title: "Set a price and an area",
    body: "Price in ETH or give it away. Show only your general area; the exact address stays private.",
  },
  {
    icon: HandCoins,
    title: "Meet and hand it over",
    body: "Agree a public spot, inspect in person, hand it over. The item is real; so is the handshake.",
  },
  {
    icon: ShieldCheck,
    title: "Optionally keep the record",
    body: "An Item Passport records what the item was and when it moved. It never claims what it's worth.",
  },
];

function Home() {
  const { data: featured } = useSuspenseQuery(featuredQuery);

  return (
    <>
      <section className="mx-auto max-w-[1440px] px-4 pt-8 sm:px-6 lg:px-10">
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="grid items-stretch lg:grid-cols-[1.05fr_1fr]">
            <div className="flex flex-col justify-center gap-7 p-7 sm:p-12">
              <img
                src={logo.url}
                alt="YARD SALE — Your Junk Deserves To Be On-Chain"
                width={520}
                height={280}
                className="w-full max-w-[420px]"
              />
              <p className="prose-measure text-lg text-muted-foreground">
                A neighbourhood marketplace for real second-hand things. List the lamp, meet the
                buyer on the driveway, and — if you want it — keep a permanent record of where the
                thing has been.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button asChild size="lg" className="rounded-xl">
                  <Link to="/browse">
                    Browse the yard
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="rounded-xl">
                  <Link to="/sell/new">List an item</Link>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Unaudited beta. On-chain minting, tokens and escrow are switched off —{" "}
                <Link to="/status" className="underline underline-offset-4">
                  see exactly what's configured
                </Link>
                .
              </p>
            </div>
            <div className="min-h-[280px] bg-secondary lg:min-h-[520px]">
              <img
                src={banner.url}
                alt="YARD SALE banner — Your Junk Deserves To Be On-Chain"
                width={1920}
                height={815}
                className="h-full w-full object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1440px] px-4 py-16 sm:px-6 lg:px-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-extrabold sm:text-3xl">Fresh on the lawn</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Recently listed items from neighbours nearby.
            </p>
          </div>
          <Link to="/browse" className="text-sm font-semibold underline underline-offset-4">
            See everything
          </Link>
        </div>

        {featured.length === 0 ? (
          <p className="mt-10 rounded-xl border border-border bg-card p-8 text-sm text-muted-foreground">
            Nothing published yet. Be the first to put something on the lawn.
          </p>
        ) : (
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {featured.map((listing, index) => (
              <ListingCard key={listing.id} listing={listing} eager={index < 4} />
            ))}
          </div>
        )}
      </section>

      <section className="border-y border-border bg-card">
        <div className="mx-auto max-w-[1440px] px-4 py-16 sm:px-6 lg:px-10">
          <h2 className="text-2xl font-extrabold sm:text-3xl">How a sale actually goes</h2>
          <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {steps.map((step) => (
              <div key={step.title} className="rounded-xl border border-border bg-background p-6">
                <step.icon aria-hidden="true" className="h-6 w-6 text-grass-deep" />
                <h3 className="mt-4 text-base font-bold">{step.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1440px] px-4 py-16 sm:px-6 lg:px-10">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-center">
          <div className="overflow-hidden rounded-2xl border border-border">
            <img
              src={yardImages.photographing}
              alt="A person photographing a vintage table lamp on a wooden table"
              width={1200}
              height={900}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          </div>
          <div>
            <h2 className="text-2xl font-extrabold sm:text-3xl">Browse by category</h2>
            <p className="prose-measure mt-3 text-sm text-muted-foreground">
              Furniture that needs a van, tools that outlived the project, records nobody plays
              anymore. It's all here.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {CATEGORIES.map((category) => (
                <Link
                  key={category.value}
                  to="/browse"
                  search={{ category: category.value }}
                  className="rounded-full border border-border bg-card px-4 py-2 text-sm font-medium transition-colors duration-200 hover:bg-secondary"
                >
                  {category.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
