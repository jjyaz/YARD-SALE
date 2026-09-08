import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, MinusCircle } from "lucide-react";

import { PageHeader } from "@/components/site/ContentPage";
import { configChecks } from "@/config/env";
import { defaultChain, supportedChains } from "@/lib/chain";

export const Route = createFileRoute("/status")({
  head: () => ({
    meta: [
      { title: "Service Status & Configuration — YARD SALE" },
      {
        name: "description",
        content:
          "Exactly which YARD SALE features are configured and which on-chain actions are switched off in this build.",
      },
      { property: "og:title", content: "Service Status — YARD SALE" },
      {
        property: "og:description",
        content: "An honest list of what is live and what is disabled on YARD SALE.",
      },
    ],
  }),
  component: StatusPage,
});

function StatusPage() {
  const checks = configChecks();

  return (
    <>
      <PageHeader
        eyebrow="Status"
        title="What actually works right now"
        intro="This page is generated from configuration, not from marketing copy. If something says not configured, the button for it is disabled everywhere in the app."
      />
      <div className="mx-auto max-w-[1440px] px-4 pb-20 sm:px-6 lg:px-10">
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <section className="rounded-xl border border-border bg-card p-6">
            <h2 className="text-lg font-bold">Feature configuration</h2>
            <ul className="mt-4 divide-y divide-border">
              {checks.map((check) => (
                <li key={check.key} className="flex items-start gap-3 py-3">
                  {check.ok ? (
                    <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-grass-deep" />
                  ) : (
                    <MinusCircle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                  )}
                  <div>
                    <p className="text-sm font-semibold">
                      {check.label}{" "}
                      <span className={check.ok ? "text-grass-deep" : "text-muted-foreground"}>
                        — {check.ok ? "configured" : "not configured"}
                      </span>
                    </p>
                    <p className="text-sm text-muted-foreground">{check.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <aside className="space-y-6">
            <section className="rounded-xl border border-border bg-card p-6">
              <h2 className="text-lg font-bold">Network</h2>
              <dl className="mt-4 space-y-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Default network</dt>
                  <dd className="mono-chain font-semibold">
                    {defaultChain.name} (chain {defaultChain.id})
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Available networks</dt>
                  <dd className="mono-chain">{supportedChains.map((c) => c.name).join(", ")}</dd>
                </div>
              </dl>
            </section>

            <section className="rounded-xl border border-warning/40 bg-warning/5 p-6">
              <h2 className="text-lg font-bold">Unaudited beta</h2>
              <p className="mt-3 text-sm text-muted-foreground">
                Minting, companion tokens, escrow and liquidity locking are switched off. They stay
                off until the contracts are deployed and independently audited, and the legal review
                checklist is complete. There are no simulated transactions anywhere in this app.
              </p>
            </section>
          </aside>
        </div>
      </div>
    </>
  );
}
