import { createFileRoute, notFound } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";

import { ListingCard } from "@/components/site/ListingCard";
import { getPublicProfile } from "@/lib/marketplace.functions";

const profileQuery = (handle: string) =>
  queryOptions({
    queryKey: ["profile", handle],
    queryFn: () => getPublicProfile({ data: { handle } }),
  });

export const Route = createFileRoute("/profile/$handle")({
  loader: async ({ context, params }) => {
    const result = await context.queryClient.ensureQueryData(profileQuery(params.handle));
    if (!result) throw notFound();
    return result;
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return {
        meta: [{ title: "Seller not found — YARD SALE" }, { name: "robots", content: "noindex" }],
      };
    }
    const name = loaderData.profile.display_name ?? loaderData.profile.handle;
    return {
      meta: [
        { title: `${name} on YARD SALE — seller profile and listings` },
        {
          name: "description",
          content: `Second-hand items listed by ${name} on YARD SALE, available for local pickup.`,
        },
        { property: "og:title", content: `${name} on YARD SALE` },
        {
          property: "og:description",
          content: `Listings from ${name}, available for local pickup.`,
        },
      ],
    };
  },
  component: ProfilePage,
});

function ProfilePage() {
  const { handle } = Route.useParams();
  const { data } = useSuspenseQuery(profileQuery(handle));
  if (!data) return null;
  const { profile, listings } = data;

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-10 sm:px-6 lg:px-10">
      <header className="rounded-2xl border border-border bg-card p-7 sm:p-10">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-grass-deep">Seller</p>
        <h1 className="mt-3 text-3xl font-extrabold sm:text-4xl">
          {profile.display_name ?? profile.handle}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">@{profile.handle}</p>
        {profile.bio ? (
          <p className="prose-measure mt-4 text-sm text-muted-foreground">{profile.bio}</p>
        ) : null}
        <dl className="mt-6 flex flex-wrap gap-8 text-sm">
          <div>
            <dt className="text-muted-foreground">Area</dt>
            <dd className="font-semibold">
              {[profile.city, profile.region].filter(Boolean).join(", ") || "Not stated"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Listings live</dt>
            <dd className="font-semibold">{listings.length}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Member since</dt>
            <dd className="font-semibold">
              {new Date(profile.created_at).toLocaleDateString("en-GB", {
                month: "long",
                year: "numeric",
              })}
            </dd>
          </div>
        </dl>
      </header>

      <section className="mt-12">
        <h2 className="text-2xl font-extrabold">Currently listed</h2>
        {listings.length === 0 ? (
          <p className="mt-6 rounded-xl border border-border bg-card p-8 text-sm text-muted-foreground">
            Nothing on the lawn right now.
          </p>
        ) : (
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {listings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
