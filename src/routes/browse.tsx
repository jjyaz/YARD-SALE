import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ListingCard } from "@/components/site/ListingCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CATEGORIES, CONDITIONS } from "@/lib/listing-meta";
import { browseListings, type BrowseInput } from "@/lib/marketplace.functions";

type Search = {
  q?: string | undefined;
  category?: string | undefined;
  condition?: string | undefined;
  city?: string | undefined;
  passport?: string | undefined;
  maxPrice?: number | undefined;
  sort?: string | undefined;
  page?: number | undefined;
};

const ANY = "any";

function pick(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

const browseQuery = (input: BrowseInput) =>
  queryOptions({
    queryKey: ["listings", "browse", input],
    queryFn: () => browseListings({ data: input }),
  });

export const Route = createFileRoute("/browse")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    q: pick(search["q"]),
    category: pick(search["category"]),
    condition: pick(search["condition"]),
    city: pick(search["city"]),
    passport: pick(search["passport"]),
    maxPrice: Number(search["maxPrice"]) > 0 ? Number(search["maxPrice"]) : undefined,
    sort: pick(search["sort"]),
    page: Number(search["page"]) > 1 ? Number(search["page"]) : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(browseQuery(deps)),
  head: () => ({
    meta: [
      { title: "Browse Second-Hand Listings — YARD SALE" },
      {
        name: "description",
        content:
          "Search local second-hand furniture, tools, electronics and free stuff. Filter by category, condition, price and area.",
      },
      { property: "og:title", content: "Browse the yard — YARD SALE" },
      {
        property: "og:description",
        content: "Local second-hand listings, filterable by category, condition, price and area.",
      },
    ],
  }),
  component: Browse,
});

function Browse() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/browse" });
  const { data } = useSuspenseQuery(browseQuery(search));
  const [cityInput, setCityInput] = useState(search.city ?? "");
  const [termInput, setTermInput] = useState(search.q ?? "");

  function update(next: Partial<Search>) {
    navigate({ search: (prev) => ({ ...prev, ...next, page: undefined }) });
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-10 sm:px-6 lg:px-10">
      <h1 className="text-3xl font-extrabold sm:text-4xl">Browse the yard</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {data.total} {data.total === 1 ? "listing" : "listings"} available for local pickup.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[280px_1fr]">
        <aside className="h-fit space-y-5 rounded-xl border border-border bg-card p-5 lg:sticky lg:top-28">
          <h2 className="text-sm font-bold uppercase tracking-wide">Filters</h2>

          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              update({ q: termInput || undefined });
            }}
          >
            <Label htmlFor="filter-q">Keyword</Label>
            <Input
              id="filter-q"
              value={termInput}
              onChange={(e) => setTermInput(e.target.value)}
              placeholder="lamp, bike, records…"
            />
          </form>

          <div className="space-y-2">
            <Label htmlFor="filter-category">Category</Label>
            <Select
              value={search.category ?? ANY}
              onValueChange={(v) => update({ category: v === ANY ? undefined : v })}
            >
              <SelectTrigger id="filter-category">
                <SelectValue placeholder="Any category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any category</SelectItem>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="filter-condition">Condition</Label>
            <Select
              value={search.condition ?? ANY}
              onValueChange={(v) => update({ condition: v === ANY ? undefined : v })}
            >
              <SelectTrigger id="filter-condition">
                <SelectValue placeholder="Any condition" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any condition</SelectItem>
                {CONDITIONS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              update({ city: cityInput || undefined });
            }}
          >
            <Label htmlFor="filter-city">Area</Label>
            <Input
              id="filter-city"
              value={cityInput}
              onChange={(e) => setCityInput(e.target.value)}
              placeholder="City or town"
            />
          </form>

          <div className="space-y-2">
            <Label htmlFor="filter-passport">On-chain</Label>
            <Select
              value={search.passport ?? ANY}
              onValueChange={(v) => update({ passport: v === ANY ? undefined : v })}
            >
              <SelectTrigger id="filter-passport">
                <SelectValue placeholder="Any" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any</SelectItem>
                <SelectItem value="minted">Passport minted</SelectItem>
                <SelectItem value="token">Companion token</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="filter-sort">Sort</Label>
            <Select
              value={search.sort ?? "newest"}
              onValueChange={(v) => update({ sort: v === "newest" ? undefined : v })}
            >
              <SelectTrigger id="filter-sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="price_asc">Price: low to high</SelectItem>
                <SelectItem value="price_desc">Price: high to low</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              setCityInput("");
              setTermInput("");
              navigate({ search: {} });
            }}
          >
            Clear filters
          </Button>
        </aside>

        <section aria-live="polite">
          {data.items.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-10 text-center">
              <p className="text-base font-semibold">Nothing matches those filters</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Try widening the area or clearing a filter.
              </p>
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {data.items.map((listing, i) => (
                <ListingCard key={listing.id} listing={listing} eager={i < 3} />
              ))}
            </div>
          )}

          {totalPages > 1 ? (
            <nav aria-label="Pagination" className="mt-10 flex items-center justify-between">
              <Button
                variant="outline"
                disabled={data.page <= 1}
                onClick={() =>
                  navigate({ search: (prev) => ({ ...prev, page: data.page - 1 || undefined }) })
                }
              >
                Previous
              </Button>
              <p className="text-sm text-muted-foreground">
                Page {data.page} of {totalPages}
              </p>
              <Button
                variant="outline"
                disabled={data.page >= totalPages}
                onClick={() => navigate({ search: (prev) => ({ ...prev, page: data.page + 1 }) })}
              >
                Next
              </Button>
            </nav>
          ) : null}
        </section>
      </div>
    </div>
  );
}
