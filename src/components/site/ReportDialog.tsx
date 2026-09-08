import { useState } from "react";
import { Flag } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "@/hooks/useSession";
import { supabase } from "@/integrations/supabase/client";

const REASONS = [
  { value: "stolen", label: "Possibly stolen" },
  { value: "prohibited", label: "Prohibited item" },
  { value: "counterfeit", label: "Counterfeit or misrepresented" },
  { value: "unsafe_meetup", label: "Unsafe meetup request" },
  { value: "spam", label: "Spam or scam" },
  { value: "other", label: "Something else" },
] as const;

type Reason = (typeof REASONS)[number]["value"];

export function ReportDialog({ listingId }: { listingId: string }) {
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<Reason>("prohibited");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!user) {
      toast.info("Sign in to report a listing.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("reports").insert({
      listing_id: listingId,
      reporter_id: user.id,
      reason,
      details: details || null,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setOpen(false);
    setDetails("");
    toast.success("Report sent to moderation.");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Flag className="mr-1 h-4 w-4" aria-hidden="true" />
          Report
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report this listing</DialogTitle>
          <DialogDescription>
            A human moderator reviews every report. Give as much detail as you can.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="report-reason">Reason</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as Reason)}>
              <SelectTrigger id="report-reason">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="report-details">Details (optional)</Label>
            <Textarea
              id="report-details"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={4}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? "Sending…" : "Send report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
