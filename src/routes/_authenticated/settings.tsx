import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { WalletPanel } from "@/components/site/WalletPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Account settings — YARD SALE" },
      { name: "description", content: "Update your profile, area and linked wallet." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Settings,
});

function Settings() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ display_name: "", handle: "", bio: "", city: "", region: "" });
  const [busy, setBusy] = useState(false);

  const profile = useQuery({
    queryKey: ["my-profile", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, handle, display_name, bio, city, region")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });

  useEffect(() => {
    if (!profile.data) return;
    setForm({
      display_name: profile.data.display_name ?? "",
      handle: profile.data.handle ?? "",
      bio: profile.data.bio ?? "",
      city: profile.data.city ?? "",
      region: profile.data.region ?? "",
    });
  }, [profile.data]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!user) return;
    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: form.display_name || null,
        handle: form.handle.trim().toLowerCase(),
        bio: form.bio || null,
        city: form.city || null,
        region: form.region || null,
      })
      .eq("id", user.id);
    setBusy(false);
    if (error) {
      toast.error(error.message.includes("duplicate") ? "That handle is taken." : error.message);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ["my-profile"] });
    toast.success("Profile updated.");
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-extrabold">Settings</h1>

      <form onSubmit={save} className="mt-8 space-y-5 rounded-xl border border-border bg-card p-6">
        <h2 className="text-lg font-bold">Public profile</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="display_name">Display name</Label>
            <Input
              id="display_name"
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="handle">Handle</Label>
            <Input
              id="handle"
              value={form.handle}
              pattern="[a-z0-9_]{3,24}"
              title="3–24 characters: lowercase letters, numbers, underscore"
              onChange={(e) => setForm({ ...form, handle: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="city">City or town</Label>
            <Input id="city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="region">Region</Label>
            <Input id="region" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="bio">Bio</Label>
          <Textarea id="bio" rows={3} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
          <p className="text-xs text-muted-foreground">
            Shown publicly. Don't include your address or phone number.
          </p>
        </div>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save profile"}
        </Button>
      </form>

      <div className="mt-8">
        <WalletPanel />
      </div>
    </div>
  );
}
