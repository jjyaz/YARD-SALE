import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/site/ListingCard";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Moderation queue — YARD SALE" },
      { name: "description", content: "Review reported listings." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Admin,
});

function Admin() {
  const { user } = useSession();
  const queryClient = useQueryClient();

  const role = useQuery({
    queryKey: ["my-roles", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", user!.id);
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => r.role as string);
    },
  });

  const isModerator = (role.data ?? []).some((r) => r === "moderator" || r === "admin");

  const reports = useQuery({
    queryKey: ["reports"],
    enabled: isModerator,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reports")
        .select("id, reason, details, status, created_at, listing_id, listings(title, slug, status)")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  async function act(reportId: string, listingId: string | null, action: "remove" | "dismiss") {
    if (!user) return;
    const { error } = await supabase
      .from("reports")
      .update({ status: action === "remove" ? "actioned" : "dismissed" })
      .eq("id", reportId);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (action === "remove" && listingId) {
      await supabase.from("listings").update({ status: "removed" }).eq("id", listingId);
    }
    await supabase.from("moderation_actions").insert({
      moderator_id: user.id,
      listing_id: listingId,
      report_id: reportId,
      action,
    });
    await queryClient.invalidateQueries({ queryKey: ["reports"] });
    toast.success(action === "remove" ? "Listing removed." : "Report dismissed.");
  }

  if (role.isLoading) {
    return <p className="mx-auto max-w-3xl px-4 py-20 text-sm text-muted-foreground">Checking access…</p>;
  }

  if (!isModerator) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20">
        <h1 className="text-2xl font-extrabold">Moderation</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          This area is for moderators. Your account doesn't have that role.
        </p>
      </div>
    );
  }

  const rows = reports.data ?? [];

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-extrabold">Moderation queue</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {rows.length} report{rows.length === 1 ? "" : "s"}. Every action is recorded.
      </p>

      {rows.length === 0 ? (
        <p className="mt-8 rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          Nothing to review.
        </p>
      ) : (
        <ul className="mt-8 space-y-4">
          {rows.map((report) => {
            const listing = report.listings as unknown as { title: string; status: string } | null;
            return (
              <li key={report.id} className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{listing?.title ?? "Listing removed"}</p>
                    <p className="text-xs text-muted-foreground">
                      {report.reason} • reported{" "}
                      {new Date(report.created_at).toLocaleDateString("en-GB")}
                    </p>
                  </div>
                  <StatusChip>{report.status}</StatusChip>
                </div>
                {report.details ? (
                  <p className="mt-3 text-sm text-muted-foreground">{report.details}</p>
                ) : null}
                {report.status === "open" ? (
                  <div className="mt-4 flex gap-3">
                    <Button size="sm" onClick={() => void act(report.id, report.listing_id, "remove")}>
                      Remove listing
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void act(report.id, report.listing_id, "dismiss")}
                    >
                      Dismiss
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
