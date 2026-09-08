import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";

/**
 * Honest disabled state. Shown wherever an on-chain action cannot run because
 * the required contract address or credential is not configured.
 */
export function ConfigRequired({
  title,
  reason,
  className = "",
}: {
  title: string;
  reason: string;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-warning/40 bg-warning/5 p-5 ${className}`}>
      <div className="flex items-start gap-3">
        <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
        <div className="space-y-2">
          <p className="text-sm font-bold">{title}</p>
          <p className="text-sm text-muted-foreground">{reason}</p>
          <Link to="/status" className="inline-block text-sm font-semibold underline underline-offset-4">
            See what is configured
          </Link>
        </div>
      </div>
    </div>
  );
}
