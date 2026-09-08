import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Trash2, Upload } from "lucide-react";

import { ConfigRequired } from "@/components/site/ConfigRequired";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { CATEGORIES, CONDITIONS, approxFiat } from "@/lib/listing-meta";

const TERMS_VERSION = "0.1";
const SIGNED_URL_TTL = 60 * 60 * 24 * 365 * 5;

type Search = { draft?: string | undefined };

export const Route = createFileRoute("/_authenticated/sell/new")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    draft: typeof search["draft"] === "string" ? search["draft"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "List an item — YARD SALE" },
      { name: "description", content: "Create a listing in six steps. Drafts save as you type." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SellWizard,
});

type Draft = {
  id: string;
  title: string;
  description: string;
  category: string;
  condition: string;
  condition_notes: string;
  brand: string;
  dimensions: string;
  price_eth: string;
  is_free: boolean;
  city: string;
  region: string;
  postal_prefix: string;
  availability: string;
  accuracy_confirmed: boolean;
  attestation_accepted: boolean;
};

type MediaRow = { id: string; storage_path: string | null; public_url: string | null };

const STEPS = ["Basics", "Photos", "Condition", "Price", "Pickup", "Review"];

function slugify(title: string): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return `${base || "item"}-${Math.random().toString(36).slice(2, 7)}`;
}

function SellWizard() {
  const { draft: draftId } = Route.useSearch();
  const { user } = useSession();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [media, setMedia] = useState<MediaRow[]>([]);
  const [pickup, setPickup] = useState({ exact_address: "", instructions: "", contact_note: "" });
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load or create the draft row.
  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      if (draftId) {
        const { data } = await supabase.from("listings").select("*").eq("id", draftId).maybeSingle();
        if (data && active) {
          setDraft({
            id: data.id,
            title: data.title ?? "",
            description: data.description ?? "",
            category: data.category ?? "",
            condition: data.condition ?? "",
            condition_notes: data.condition_notes ?? "",
            brand: data.brand ?? "",
            dimensions: data.dimensions ?? "",
            price_eth: String(data.price_eth ?? ""),
            is_free: data.is_free,
            city: data.city ?? "",
            region: data.region ?? "",
            postal_prefix: data.postal_prefix ?? "",
            availability: data.availability ?? "",
            accuracy_confirmed: data.accuracy_confirmed,
            attestation_accepted: data.attestation_accepted,
          });
          setStep(Math.min(6, Math.max(1, data.wizard_step)));
          const { data: mediaRows } = await supabase
            .from("listing_media")
            .select("id, storage_path, public_url")
            .eq("listing_id", data.id)
            .order("ordinal");
          if (active) setMedia(mediaRows ?? []);
        }
        return;
      }
      const { data, error } = await supabase
        .from("listings")
        .insert({ seller_id: user.id, slug: slugify("draft"), status: "draft" })
        .select("id")
        .single();
      if (error) {
        toast.error(error.message);
        return;
      }
      if (!active) return;
      navigate({ to: "/sell/new", search: { draft: data.id }, replace: true });
    })();
    return () => {
      active = false;
    };
  }, [user, draftId, navigate]);

  const persist = useCallback(
    async (next: Draft, nextStep: number) => {
      setSaving(true);
      const { error } = await supabase
        .from("listings")
        .update({
          title: next.title,
          description: next.description,
          category: (next.category || null) as never,
          condition: (next.condition || null) as never,
          condition_notes: next.condition_notes || null,
          brand: next.brand || null,
          dimensions: next.dimensions || null,
          price_eth: next.is_free ? 0 : Number(next.price_eth || 0),
          price_wei: next.is_free ? 0 : Math.round(Number(next.price_eth || 0) * 1e18),
          is_free: next.is_free,
          city: next.city || null,
          region: next.region || null,
          postal_prefix: next.postal_prefix || null,
          availability: next.availability || null,
          accuracy_confirmed: next.accuracy_confirmed,
          attestation_accepted: next.attestation_accepted,
          wizard_step: nextStep,
        })
        .eq("id", next.id);
      setSaving(false);
      if (error) toast.error(error.message);
    },
    [],
  );

  function patch(changes: Partial<Draft>) {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...changes };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void persist(next, step), 700);
      return next;
    });
  }

  async function uploadPhotos(files: FileList | null) {
    if (!files || !draft || !user) return;
    for (const file of Array.from(files).slice(0, 8)) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`${file.name} is larger than 10MB.`);
        continue;
      }
      const path = `${user.id}/${draft.id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
      const { error } = await supabase.storage.from("listing-public").upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (error) {
        toast.error(error.message);
        continue;
      }
      const { data: signed } = await supabase.storage
        .from("listing-public")
        .createSignedUrl(path, SIGNED_URL_TTL);
      const { data: row, error: mediaError } = await supabase
        .from("listing_media")
        .insert({
          listing_id: draft.id,
          storage_path: path,
          public_url: signed?.signedUrl ?? null,
          ordinal: media.length,
          is_cover: media.length === 0,
        })
        .select("id, storage_path, public_url")
        .single();
      if (mediaError) {
        toast.error(mediaError.message);
        continue;
      }
      setMedia((prev) => [...prev, row]);
    }
  }

  async function removePhoto(row: MediaRow) {
    await supabase.from("listing_media").delete().eq("id", row.id);
    if (row.storage_path) await supabase.storage.from("listing-public").remove([row.storage_path]);
    setMedia((prev) => prev.filter((m) => m.id !== row.id));
  }

  async function savePickup() {
    if (!draft || !user) return;
    const { error } = await supabase.from("private_pickup_details").upsert(
      {
        listing_id: draft.id,
        seller_id: user.id,
        exact_address: pickup.exact_address || null,
        instructions: pickup.instructions || null,
        contact_note: pickup.contact_note || null,
      },
      { onConflict: "listing_id" },
    );
    if (error) toast.error(error.message);
  }

  async function publish() {
    if (!draft) return;
    setPublishing(true);
    await persist(draft, 6);
    await savePickup();
    const { error } = await supabase
      .from("listings")
      .update({
        slug: slugify(draft.title),
        status: "published",
        published_at: new Date().toISOString(),
        terms_version: TERMS_VERSION,
      })
      .eq("id", draft.id);
    setPublishing(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Your listing is live.");
    navigate({ to: "/dashboard" });
  }

  if (!draft) {
    return (
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        Preparing your draft…
      </div>
    );
  }

  const canPublish =
    draft.title.trim().length >= 4 &&
    draft.description.trim().length >= 20 &&
    Boolean(draft.category) &&
    Boolean(draft.condition) &&
    media.length > 0 &&
    Boolean(draft.city) &&
    draft.accuracy_confirmed &&
    draft.attestation_accepted;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-extrabold">List an item</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Step {step} of 6 — {STEPS[step - 1]}. {saving ? "Saving…" : "Draft saved automatically."}
      </p>
      <Progress value={(step / 6) * 100} className="mt-4" />

      <div className="mt-8 space-y-6 rounded-xl border border-border bg-card p-6">
        {step === 1 ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={draft.title}
                onChange={(e) => patch({ title: e.target.value })}
                placeholder="Teak side table, 1970s"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                rows={6}
                value={draft.description}
                onChange={(e) => patch({ description: e.target.value })}
                placeholder="What it is, how you used it, why you're letting it go, and every flaw you can see."
              />
              <p className="text-xs text-muted-foreground">At least 20 characters. Be honest about flaws.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <Select value={draft.category} onValueChange={(v) => patch({ category: v })}>
                <SelectTrigger id="category">
                  <SelectValue placeholder="Choose a category" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <div>
              <Label htmlFor="photos">Photos</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                At least one photo of the actual item. Up to 8, 10MB each.
              </p>
              <div className="mt-3 flex items-center gap-3">
                <Input
                  id="photos"
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => void uploadPhotos(e.target.files)}
                />
                <Upload className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              </div>
            </div>
            {media.length > 0 ? (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {media.map((row) => (
                  <li key={row.id} className="relative overflow-hidden rounded-lg border border-border">
                    {row.public_url ? (
                      <img src={row.public_url} alt="" className="aspect-[4/3] w-full object-cover" />
                    ) : (
                      <div className="aspect-[4/3] w-full bg-secondary" />
                    )}
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      aria-label="Remove photo"
                      className="absolute right-2 top-2 h-8 w-8"
                      onClick={() => void removePhoto(row)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No photos yet.</p>
            )}
          </>
        ) : null}

        {step === 3 ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="condition">Condition</Label>
              <Select value={draft.condition} onValueChange={(v) => patch({ condition: v })}>
                <SelectTrigger id="condition">
                  <SelectValue placeholder="Choose a condition" />
                </SelectTrigger>
                <SelectContent>
                  {CONDITIONS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="condition_notes">Flaws and repairs</Label>
              <Textarea
                id="condition_notes"
                rows={4}
                value={draft.condition_notes}
                onChange={(e) => patch({ condition_notes: e.target.value })}
                placeholder="Water ring on the top, one wobbly leg, previously re-glued."
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="brand">Brand or maker</Label>
                <Input id="brand" value={draft.brand} onChange={(e) => patch({ brand: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dimensions">Dimensions</Label>
                <Input
                  id="dimensions"
                  value={draft.dimensions}
                  onChange={(e) => patch({ dimensions: e.target.value })}
                  placeholder="55 × 40 × 48 cm"
                />
              </div>
            </div>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <div className="flex items-center gap-3">
              <Checkbox
                id="is_free"
                checked={draft.is_free}
                onCheckedChange={(v) => patch({ is_free: Boolean(v) })}
              />
              <Label htmlFor="is_free">Give it away free</Label>
            </div>
            {!draft.is_free ? (
              <div className="space-y-2">
                <Label htmlFor="price">Price in ETH</Label>
                <Input
                  id="price"
                  inputMode="decimal"
                  value={draft.price_eth}
                  onChange={(e) => patch({ price_eth: e.target.value })}
                  placeholder="0.05"
                />
                <p className="text-xs text-muted-foreground">
                  {approxFiat(Number(draft.price_eth || 0)) ?? "Enter a price to see an approximate value."}{" "}
                  Fiat figures are rough estimates only.
                </p>
              </div>
            ) : null}
            <ConfigRequired
              title="Escrow is not available"
              reason="Buyers cannot fund an on-chain escrow in this build, because no escrow contract is deployed. Payment is arranged directly between you and the buyer at pickup."
            />
          </>
        ) : null}

        {step === 5 ? (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="city">City or town (public)</Label>
                <Input id="city" value={draft.city} onChange={(e) => patch({ city: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="region">Region (public)</Label>
                <Input id="region" value={draft.region} onChange={(e) => patch({ region: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="postal_prefix">Postcode prefix (public)</Label>
                <Input
                  id="postal_prefix"
                  value={draft.postal_prefix}
                  onChange={(e) => patch({ postal_prefix: e.target.value })}
                  placeholder="SE15"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="availability">When you're available (public)</Label>
              <Input
                id="availability"
                value={draft.availability}
                onChange={(e) => patch({ availability: e.target.value })}
                placeholder="Weekday evenings, Saturday mornings"
              />
            </div>
            <div className="rounded-lg border border-border bg-background p-4">
              <p className="text-sm font-bold">Private pickup details</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Only you can read these. They are never shown publicly and never written on-chain.
              </p>
              <div className="mt-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="exact_address">Exact address</Label>
                  <Input
                    id="exact_address"
                    value={pickup.exact_address}
                    onChange={(e) => setPickup({ ...pickup, exact_address: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="instructions">Access instructions</Label>
                  <Textarea
                    id="instructions"
                    rows={3}
                    value={pickup.instructions}
                    onChange={(e) => setPickup({ ...pickup, instructions: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contact_note">Contact note</Label>
                  <Input
                    id="contact_note"
                    value={pickup.contact_note}
                    onChange={(e) => setPickup({ ...pickup, contact_note: e.target.value })}
                  />
                </div>
              </div>
            </div>
          </>
        ) : null}

        {step === 6 ? (
          <>
            <h2 className="text-lg font-bold">Review and publish</h2>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>Title: {draft.title || "— missing"}</li>
              <li>Category: {draft.category || "— missing"}</li>
              <li>Condition: {draft.condition || "— missing"}</li>
              <li>Photos: {media.length}</li>
              <li>Price: {draft.is_free ? "Free" : `${draft.price_eth || "0"} ETH`}</li>
              <li>Area: {[draft.city, draft.region].filter(Boolean).join(", ") || "— missing"}</li>
            </ul>
            <div className="space-y-3">
              <label className="flex items-start gap-3 text-sm">
                <Checkbox
                  checked={draft.accuracy_confirmed}
                  onCheckedChange={(v) => patch({ accuracy_confirmed: Boolean(v) })}
                />
                <span>
                  I confirm the description and photos are of this actual item and are accurate,
                  including its flaws.
                </span>
              </label>
              <label className="flex items-start gap-3 text-sm">
                <Checkbox
                  checked={draft.attestation_accepted}
                  onCheckedChange={(v) => patch({ attestation_accepted: Boolean(v) })}
                />
                <span>
                  I own this item or have the right to sell it, it is not prohibited, and I accept
                  the terms of use (version {TERMS_VERSION}).
                </span>
              </label>
            </div>
            {!canPublish ? (
              <p className="text-sm text-warning">
                Add the missing details above before publishing.
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <Button
          variant="outline"
          disabled={step === 1}
          onClick={() => {
            const next = step - 1;
            setStep(next);
            void persist(draft, next);
          }}
        >
          Back
        </Button>
        {step < 6 ? (
          <Button
            onClick={() => {
              const next = step + 1;
              setStep(next);
              void persist(draft, next);
              if (step === 5) void savePickup();
            }}
          >
            Continue
          </Button>
        ) : (
          <Button disabled={!canPublish || publishing} onClick={() => void publish()}>
            {publishing ? "Publishing…" : "Publish listing"}
          </Button>
        )}
      </div>
    </div>
  );
}
