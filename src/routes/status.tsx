import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, Loader2, MinusCircle } from "lucide-react";

import { PageHeader } from "@/components/site/ContentPage";
import { configChecks } from "@/config/env";
import { activeChain, explorerAddressUrl, supportedChains } from "@/lib/chain";
import { getDeploymentHealth } from "@/lib/deployment-health.functions";

export const Route = createFileRoute("/status")({
  head: () => ({
    meta: [
      { title: "Service Status & Configuration — YARD SALE" },
      {
        name: "description",
        content:
          "Exactly which YARD SALE features are configured, which live on-chain checks pass, and which actions are switched off in this build.",
      },
      { property: "og:title", content: "Service Status — YARD SALE" },
      {
        property: "og:description",
        content: "An honest, live list of what is deployed, verified and disabled on YARD SALE.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StatusPage,
});

type Check = { key: string; label: string; ok: boolean; severity: "blocker" | "warning"; detail: string };

function CheckList({ checks }: { checks: Check[] }) {
  return (
    <ul className="mt-4 divide-y divide-border">
      {checks.map((check) => (
        <li key={check.key} className="flex items-start gap-3 py-3">
          {check.ok ? (
            <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-grass-deep" />
          ) : check.severity === "warning" ? (
            <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          ) : (
            <MinusCircle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          )}
          <div>
            <p className="text-sm font-semibold">
              {check.label}{" "}
              <span className={check.ok ? "text-grass-deep" : check.severity === "warning" ? "text-warning" : "text-muted-foreground"}>
                — {check.ok ? "passed" : check.severity === "warning" ? "warning" : "blocked"}
              </span>
            </p>
            <p className="break-words text-sm text-muted-foreground">{check.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Address({ chainId, value }: { chainId: number; value: string | null }) {
  if (!value) return <span className="text-muted-foreground">not configured</span>;
  return (
    <a className="break-all font-mono text-xs underline underline-offset-4" href={explorerAddressUrl(chainId, value)} target="_blank" rel="noreferrer">
      {value}
    </a>
  );
}

function StatusPage() {
  const checks = configChecks();
  const loadHealth = useServerFn(getDeploymentHealth);
  const health = useQuery({
    queryKey: ["deployment-health"],
    queryFn: () => loadHealth({ data: {} }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const deployment = health.data?.deployment ?? null;
  const liquidity = health.data?.liquidity ?? null;
  const ipfs = health.data?.ipfs ?? null;

  return (
    <>
      <PageHeader
        eyebrow="Status"
        title="What actually works right now"
        intro="This page is generated from configuration and live on-chain reads, not from marketing copy. If something says blocked, the button for it is disabled everywhere in the app."
      />
      <div className="mx-auto max-w-[1440px] px-4 pb-20 sm:px-6 lg:px-10">
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-6">
            <section className="rounded-xl border border-border bg-card p-6">
              <h2 className="text-lg font-bold">Live deployment checks</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Read directly from the chain each time this page loads: address format, bytecode, interfaces, registry↔factory pointers, roles,
                pause state and implementation lock.
              </p>
              {health.isLoading ? (
                <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Querying {activeChain.name}…
                </p>
              ) : health.isError ? (
                <p className="mt-4 text-sm text-destructive">{health.error instanceof Error ? health.error.message : "The health check failed."}</p>
              ) : deployment ? (
                <>
                  <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-muted-foreground">Active chain</dt>
                      <dd className="font-semibold">
                        {deployment.chainName} ({deployment.chainId})
                        {deployment.mainnetRequested && !deployment.mainnetEnabled ? " — mainnet requested but not enabled" : ""}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Overall</dt>
                      <dd className={`font-semibold ${deployment.ready ? "text-grass-deep" : "text-muted-foreground"}`}>
                        {deployment.ready ? "On-chain writes enabled" : "On-chain writes blocked"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Item Passport registry</dt>
                      <dd>
                        <Address chainId={deployment.chainId} value={deployment.registry} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Companion Token factory</dt>
                      <dd>
                        <Address chainId={deployment.chainId} value={deployment.factory} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Token implementation</dt>
                      <dd>
                        <Address chainId={deployment.chainId} value={deployment.implementation} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Treasury</dt>
                      <dd>
                        <Address chainId={deployment.chainId} value={deployment.treasury} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Passports minted</dt>
                      <dd>{deployment.totalMinted ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Checked</dt>
                      <dd>{new Date(deployment.checkedAt).toLocaleString()}</dd>
                    </div>
                  </dl>
                  <CheckList checks={deployment.checks} />
                </>
              ) : null}
            </section>

            <section className="rounded-xl border border-border bg-card p-6">
              <h2 className="text-lg font-bold">Uniswap v3 liquidity (mainnet only)</h2>
              {liquidity ? (
                <>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {liquidity.available
                      ? `Official Robinhood Chain deployment verified on chain ${liquidity.chainId}: factory, position manager and WETH have the expected bytecode and the ${liquidity.feeTier / 10_000}% fee tier is enabled.`
                      : "Locked. Available after testnet validation and mainnet contract review."}
                  </p>
                  <CheckList checks={liquidity.checks} />
                </>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">Waiting for the live check…</p>
              )}
            </section>

            <section className="rounded-xl border border-border bg-card p-6">
              <h2 className="text-lg font-bold">Feature configuration</h2>
              <ul className="mt-4 divide-y divide-border">
                {checks.map((check) => (
                  <li key={check.key} className="flex items-start gap-3 py-3">
                    {check.ready ? (
                      <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-grass-deep" />
                    ) : (
                      <MinusCircle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                    )}
                    <div>
                      <p className="text-sm font-semibold">
                        {check.label}{" "}
                        <span className={check.ready ? "text-grass-deep" : "text-muted-foreground"}>— {check.ready ? "configured" : "not configured"}</span>
                      </p>
                      <p className="text-sm text-muted-foreground">{check.detail}</p>
                    </div>
                  </li>
                ))}
                <li className="flex items-start gap-3 py-3">
                  {ipfs?.configured ? (
                    <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-grass-deep" />
                  ) : (
                    <MinusCircle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                  )}
                  <div>
                    <p className="text-sm font-semibold">
                      IPFS pinning{" "}
                      <span className={ipfs?.configured ? "text-grass-deep" : "text-muted-foreground"}>— {ipfs?.configured ? "configured" : "not configured"}</span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {ipfs?.configured
                        ? `Passport metadata is pinned through ${ipfs.provider} and referenced by ipfs:// URI.`
                        : `Set the server secret ${ipfs?.missing ?? "PINATA_JWT"} to pin passport metadata to IPFS. Without it, testnet passports reference a storage copy (hash still on-chain) and mainnet minting is blocked.`}
                    </p>
                  </div>
                </li>
              </ul>
            </section>
          </div>

          <aside className="space-y-6">
            <section className="rounded-xl border border-border bg-card p-6">
              <h2 className="text-lg font-bold">Network</h2>
              <dl className="mt-4 space-y-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Active network</dt>
                  <dd className="mono-chain font-semibold">
                    {activeChain.name} (chain {activeChain.id})
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Enabled networks</dt>
                  <dd className="mono-chain">{supportedChains.map((c) => c.name).join(", ")}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Explorer</dt>
                  <dd className="mono-chain break-all">{activeChain.blockExplorers?.default.url}</dd>
                </div>
              </dl>
            </section>

            <section className="rounded-xl border border-warning/40 bg-warning/5 p-6">
              <h2 className="text-lg font-bold">Unaudited beta</h2>
              <p className="mt-3 text-sm text-muted-foreground">
                Item Passport minting and Companion Token launches only run when every deployment check above passes; Uniswap liquidity only
                on mainnet with the official deployment verified. Escrow and liquidity locking are not built yet. The contracts have not been
                independently audited. There are no simulated transactions anywhere in this app.
              </p>
            </section>
          </aside>
        </div>
      </div>
    </>
  );
}
