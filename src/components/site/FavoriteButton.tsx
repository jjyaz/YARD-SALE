import { useEffect, useState } from "react";
import { Heart } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/useSession";
import { supabase } from "@/integrations/supabase/client";

export function FavoriteButton({ listingId }: { listingId: string }) {
  const { user } = useSession();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) {
      setSaved(false);
      return;
    }
    let active = true;
    supabase
      .from("favorites")
      .select("id")
      .eq("listing_id", listingId)
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setSaved(Boolean(data));
      });
    return () => {
      active = false;
    };
  }, [user, listingId]);

  async function toggle() {
    if (!user) {
      toast.info("Sign in to save this listing.");
      return;
    }
    setBusy(true);
    if (saved) {
      const { error } = await supabase
        .from("favorites")
        .delete()
        .eq("listing_id", listingId)
        .eq("user_id", user.id);
      setBusy(false);
      if (error) return toast.error(error.message);
      setSaved(false);
      return;
    }
    const { error } = await supabase
      .from("favorites")
      .insert({ listing_id: listingId, user_id: user.id });
    setBusy(false);
    if (error) return toast.error(error.message);
    setSaved(true);
    toast.success("Saved to your favourites.");
  }

  return (
    <Button variant={saved ? "default" : "outline"} onClick={() => void toggle()} disabled={busy}>
      <Heart className={`mr-1 h-4 w-4 ${saved ? "fill-current" : ""}`} aria-hidden="true" />
      {saved ? "Saved" : "Save"}
    </Button>
  );
}
