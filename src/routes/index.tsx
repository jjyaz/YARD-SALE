import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import {
  ArrowRight,
  Camera,
  Coins,
  Database,
  FileText,
  Fingerprint,
  HandCoins,
  Hash,
  Image as ImageIcon,
  Link2,
  MapPin,
  ShieldCheck,
} from "lucide-react";

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
          "Sell the couch, keep the story. A neighbourhood marketplace for real second-hand things — turn any listing into a real-world asset (RWA) on-chain with an Item Passport, then pair and launch a companion token via the Launchpad on Robinhood Chain.",
      },
      { property: "og:title", content: "YARD SALE — Your Junk Deserves To Be On-Chain" },
      {
        property: "og:description",
        content:
          "A neighbourhood marketplace for real second-hand things. Turn any listing into an on-chain RWA with an Item Passport, then pair and launch a companion token via the Launchpad on Robinhood Chain.",
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
          <img
            src={banner.url}
            alt="YARD SALE — Your Junk Deserves To Be On-Chain"
            width={1920}
            height={815}
            className="h-full max-h-[460px] w-full object-cover sm:max-h-[560px]"
          />
          <div className="flex flex-col gap-7 p-7 sm:p-12">
            <p className="prose-measure text-lg text-muted-foreground">
              A neighbourhood marketplace for real second-hand things. List the lamp, meet the buyer
              on the driveway — and when you're ready, turn the listing into a real-world asset
              on-chain. Mint an Item Passport to prove what the thing is and where it's been, then
              pair it with a companion token and launch it through the Launchpad.
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
            <h2 className="text-2xl font-extrabold sm:text-3xl">From driveway to on-chain</h2>
            <p className="prose-measure mt-3 text-sm text-muted-foreground">
              A listing starts as ordinary photos and a description. When you're ready, the
              Launchpad turns it into a real-world asset (RWA) on Robinhood Chain: it freezes the
              finalized details, mints an Item Passport to prove what the item is and who listed it,
              and optionally pairs a fixed-supply companion token you can launch.
            </p>
            <p className="prose-measure mt-3 text-sm text-muted-foreground">
              The chain never stores the photos themselves. It stores fingerprints — hashes — that
              let anyone verify the on-chain record against the frozen file. Here's exactly where
              each piece lives.
            </p>
          </div>
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-grass-deep/10 text-grass-deep">
                <Fingerprint aria-hidden="true" className="h-5 w-5" />
              </span>
              <div>
                <h3 className="text-base font-bold">On-chain — Robinhood Chain</h3>
                <p className="text-xs text-muted-foreground">Permanent, public, verifiable</p>
              </div>
            </div>
            <ul className="mt-5 space-y-3 text-sm text-muted-foreground">
              <li className="flex gap-2">
                <ShieldCheck
                  aria-hidden="true"
                  className="mt-0.5 h-4 w-4 shrink-0 text-grass-deep"
                />
                <span>
                  The Item Passport token id and its owner — an ERC-721 proving the passport exists
                  and who holds it.
                </span>
              </li>
              <li className="flex gap-2">
                <Hash aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-grass-deep" />
                <span>
                  The immutable listing id, metadata hash and terms hash — fingerprints so anyone
                  can confirm the on-chain record matches the frozen file.
                </span>
              </li>
              <li className="flex gap-2">
                <Link2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-grass-deep" />
                <span>
                  A metadata URI pointing to the frozen passport JSON, plus the passport's lifecycle
                  status (Listed, Reserved, Collected, Withdrawn, Disputed).
                </span>
              </li>
              <li className="flex gap-2">
                <Coins aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-grass-deep" />
                <span>
                  For a launched companion token: its name, symbol, fixed total supply, balances,
                  and the address permanently paired to one passport. No extra minting, ever.
                </span>
              </li>
            </ul>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-foreground">
                <Database aria-hidden="true" className="h-5 w-5" />
              </span>
              <div>
                <h3 className="text-base font-bold">In storage — off-chain</h3>
                <p className="text-xs text-muted-foreground">Readable files, kept private to you</p>
              </div>
            </div>
            <ul className="mt-5 space-y-3 text-sm text-muted-foreground">
              <li className="flex gap-2">
                <ImageIcon
                  aria-hidden="true"
                  className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                />
                <span>
                  The actual photo files — full-resolution images, with a SHA-256 of each stored
                  on-chain so they can't be swapped unnoticed.
                </span>
              </li>
              <li className="flex gap-2">
                <FileText
                  aria-hidden="true"
                  className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                />
                <span>
                  The complete frozen passport metadata JSON: title, description, attributes, all
                  image links, disclaimer and terms version.
                </span>
              </li>
              <li className="flex gap-2">
                <ShieldCheck
                  aria-hidden="true"
                  className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                />
                <span>
                  Listing terms, seller details, sale offers, and messages — none of this lives on
                  the chain.
                </span>
              </li>
              <li className="flex gap-2">
                <Database
                  aria-hidden="true"
                  className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                />
                <span>
                  Transaction receipts, block numbers and wallet records — kept only to reconcile
                  and recover your on-chain state.
                </span>
              </li>
            </ul>
          </div>
        </div>

        <p className="prose-measure mt-8 text-xs text-muted-foreground">
          Minting and token launches stay switched off until the contracts are deployed and audited.{" "}
          <Link to="/status" className="underline underline-offset-4">
            See exactly what's configured
          </Link>{" "}
          before you rely on any of it.
        </p>
      </section>

      <section className="mx-auto max-w-[1440px] px-4 py-16 sm:px-6 lg:px-10">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-center">
          <div className="overflow-hidden rounded-2xl border border-border">
            <img
              src={yardImages.porchPickup}
              alt="A buyer and seller meeting in person to hand over a purchased item at a yard sale"
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
