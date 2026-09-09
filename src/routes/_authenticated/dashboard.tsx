import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusChip } from "@/components/site/ListingCard";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { formatEth } from "@/lib/listing-meta";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "My Yard — your listings and favourites | YARD SALE" },
      { name: "description", content: "Manage your drafts, published listings and saved items." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Dashboard,
});

type ListingRow = {
  id: string;
  slug: string;
  title: string;
  status: string;
  price_eth: number;
  is_free: boolean;
  wizard_step: number;
  updated_at: string;
};

function Dashboard() {
  const { user } = useSession();

  const listings = useQuery({
    queryKey: ["my-listings", user?.id],
    enabled: Boolean(user),
    queryFn: async (): Promise<ListingRow[]> => {
      const { data, error } = await supabase
        .from("listings")
        .select("id, slug, title, status, price_eth, is_free, wizard_step, updated_at")
        .eq("seller_id", user!.id)
        .order("updated_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as ListingRow[];
    },
  });

  const favorites = useQuery({
    queryKey: ["my-favorites", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("favorites")
        .select("id, listings(id, slug, title, price_eth, is_free, status)")
        .eq("user_id", user!.id);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const rows = listings.data ?? [];
  const drafts = rows.filter((r) => r.status === "draft");
  const live = rows.filter((r) => r.status !== "draft" && r.status !== "removed");

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-10 sm:px-6 lg:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold sm:text-4xl">My yard</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Drafts save automatically. Nothing is public until you publish it.
          </p>
        </div>
        <Button asChild className="rounded-xl">
          <Link to="/sell/new">List an item</Link>
        </Button>
      </div>

      <Tabs defaultValue="live" className="mt-8">
        <TabsList>
          <TabsTrigger value="live">Published ({live.length})</TabsTrigger>
          <TabsTrigger value="drafts">Drafts ({drafts.length})</TabsTrigger>
          <TabsTrigger value="saved">Saved ({favorites.data?.length ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="live">
          <ListingTable rows={live} loading={listings.isLoading} empty="Nothing published yet." />
        </TabsContent>

        <TabsContent value="drafts">
          <ListingTable
            rows={drafts}
            loading={listings.isLoading}
            empty="No drafts in progress."
            draft
          />
        </TabsContent>

        <TabsContent value="saved">
          <div className="mt-4 rounded-xl border border-border bg-card p-5">
            {favorites.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (favorites.data?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">You haven't saved anything yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {favorites.data!.map((fav) => {
                  const listing = fav.listings as unknown as {
                    slug: string;
                    title: string;
                    price_eth: number;
                    is_free: boolean;
                  } | null;
                  if (!listing) return null;
                  return (
                    <li key={fav.id} className="flex items-center justify-between gap-4 py-3">
                      <Link
                        to="/item/$slug"
                        params={{ slug: listing.slug }}
                        className="font-semibold underline underline-offset-4"
                      >
                        {listing.title}
                      </Link>
                      <span className="font-mono text-sm">
                        {formatEth(listing.price_eth, listing.is_free)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ListingTable({
  rows,
  loading,
  empty,
  draft = false,
}: {
  rows: ListingRow[];
  loading: boolean;
  empty: string;
  draft?: boolean;
}) {
  if (loading) {
    return (
      <p className="mt-4 rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
        Loading…
      </p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="mt-4 rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
        {empty}
      </p>
    );
  }
  return (
    <ul className="mt-4 divide-y divide-border rounded-xl border border-border bg-card">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="font-semibold">{row.title || "Untitled draft"}</p>
            <p className="text-xs text-muted-foreground">
              Updated {new Date(row.updated_at).toLocaleDateString("en-GB")}
              {draft ? ` • step ${row.wizard_step} of 6` : ""}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <StatusChip>{row.status}</StatusChip>
            <span className="font-mono text-sm">{formatEth(row.price_eth, row.is_free)}</span>
            {draft ? (
              <Button asChild size="sm" variant="outline">
                <Link to="/sell/new" search={{ draft: row.id }}>
                  Continue
                </Link>
              </Button>
            ) : (
              <Button asChild size="sm" variant="outline">
                <Link to="/item/$slug" params={{ slug: row.slug }}>
                  View
                </Link>
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
