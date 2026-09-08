import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Check, ExternalLink, Lock, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfigRequired } from "@/components/site/ConfigRequired";
import { StatusChip } from "@/components/site/ListingCard";
import { defaultChain, explorerAddressUrl, explorerTxUrl } from "@/lib/chain";
import { publicEnv } from "@/config/env";
import { shortAddress } from "@/lib/listing-meta";
import { assetRegistryAbi, tokenFactoryAbi } from "@/lib/abi";
import { COMPANION_TOKEN_DISCLAIMER, eligibilityLabel, toTokenUnits } from "@/lib/passport-metadata";
import { connectAccount, ensureChain, injectedProvider, sendTransaction } from "@/lib/wallet-client";
import {
  freezePassportMetadata,
  getLaunchpadState,
  recordMintSubmission,
  recordTokenSubmission,
  reconcileCompanionToken,
  reconcilePassport,
} from "@/lib/launchpad.functions";

export const Route = createFileRoute("/_authenticated/launchpad")({
  head: () => ({
    meta: [
      { title: "Launchpad — mint an Item Passport | YARD SALE" },
      {
        name: "description",
        content:
          "Freeze your listing metadata, mint a verifiable Item Passport on Robinhood Chain testnet, and optionally launch a fixed-supply companion token.",
      },
      { property: "og:title", content: "YARD SALE Launchpad" },
      { property: "og:description", content: "Mint a verifiable Item Passport on Robinhood Chain testnet." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Launchpad,
});

function Step({ index, title, done, children }: { index: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-bold ${
            done ? "border-transparent bg-primary text-primary-foreground" : "border-border"
          }`}
        >
          {done ? <Check className="h-4 w-4" /> : index}
        </span>
        <h2 className="text-base font-bold">{title}</h2>
      </div>
      <div className="mt-4 space-y-3 text-sm">{children}</div>
    </section>
  );
}

function Field({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[10rem_1fr]">
      <span className="text-muted-foreground">{label}</span>
      <span className={`break-all ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  );
}

function Launchpad() {
  const queryClient = useQueryClient();
  const loadState = useServerFn(getLaunchpadState);
  const freeze = useServerFn(freezePassportMetadata);
  const submitMint = useServerFn(recordMintSubmission);
  const verifyMint = useServerFn(reconcilePassport);
  const submitToken = useServerFn(recordTokenSubmission);
  const verifyToken = useServerFn(reconcileCompanionToken);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tokenName, setTokenName] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState("");
  const [tokenSupply, setTokenSupply] = useState("1000000");
  const [tokenAllocation, setTokenAllocation] = useState("700000");
  const [accepted, setAccepted] = useState(false);

  const state = useQuery({
    queryKey: ["launchpad"],
    queryFn: () => loadState({ data: undefined }),
    refetchOnWindowFocus: false,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["launchpad"] });

  const items = state.data?.items ?? [];
  const selected = items.find((item) => item.listing.id === selectedId) ?? null;
  const passport = selected?.passport ?? null;
  const companion = selected?.companionToken ?? null;

  const missing: string[] = [];
  if (!publicEnv.assetRegistryAddress) missing.push("Item Passport registry address (VITE_ASSET_REGISTRY_ADDRESS)");
  if (!publicEnv.tokenFactoryAddress) missing.push("Companion token factory address (VITE_TOKEN_FACTORY_ADDRESS)");
  if (!publicEnv.testnetRpcUrl) missing.push("Robinhood testnet RPC URL (VITE_ROBINHOOD_TESTNET_RPC_URL)");
  if (state.data && !state.data.wallet) missing.push("A verified wallet linked in Settings");
  if (typeof window !== "undefined" && !injectedProvider()) missing.push("A browser wallet extension");

  const registryReady = Boolean(publicEnv.assetRegistryAddress);
  const factoryReady = Boolean(publicEnv.tokenFactoryAddress);

  async function run<T>(key: string, fn: () => Promise<T>) {
    setBusy(key);
    try {
      await fn();
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const freezeMutation = useMutation({ mutationFn: freeze });

  async function onFreeze() {
    if (!selected) return;
    await run("freeze", async () => {
      await freezeMutation.mutateAsync({ data: { listingId: selected.listing.id } });
      toast.success("Metadata frozen and uploaded.");
    });
  }

  async function onMint() {
    if (!selected || !passport) return;
    await run("mint", async () => {
      const { encodeFunctionData } = await import("viem");
      const account = await connectAccount();
      await ensureChain();
      const data = encodeFunctionData({
        abi: assetRegistryAbi,
        functionName: "mintPassport",
        args: [
          account as `0x${string}`,
          passport.listing_key as `0x${string}`,
          passport.metadata_uri,
          passport.metadata_hash as `0x${string}`,
          passport.terms_hash as `0x${string}`,
        ],
      });
      const hash = await sendTransaction({
        from: account,
        to: publicEnv.assetRegistryAddress,
        data,
      });
      await submitMint({ data: { listingId: selected.listing.id, txHash: hash, wallet: account } });
      toast.message("Mint submitted. Waiting for the receipt…");
      await verifyMint({ data: { listingId: selected.listing.id } });
      toast.success("Item Passport verified on-chain.");
    });
  }

  async function onVerifyMint() {
    if (!selected) return;
    await run("verify-mint", async () => {
      await verifyMint({ data: { listingId: selected.listing.id } });
      toast.success("Receipt reconciled.");
    });
  }

  async function onCreateToken() {
    if (!selected || !passport?.token_id) return;
    await run("token", async () => {
      const { encodeFunctionData } = await import("viem");
      const supply = toTokenUnits(tokenSupply);
      const allocation = toTokenUnits(tokenAllocation);
      if (allocation > supply) throw new Error("Your allocation cannot exceed the total supply.");
      const account = await connectAccount();
      await ensureChain();
      const data = encodeFunctionData({
        abi: tokenFactoryAbi,
        functionName: "createCompanionToken",
        args: [BigInt(String(passport.token_id)), tokenName.trim(), tokenSymbol.trim().toUpperCase(), supply, allocation],
      });
      const hash = await sendTransaction({ from: account, to: publicEnv.tokenFactoryAddress, data });
      await submitToken({
        data: {
          listingId: selected.listing.id,
          txHash: hash,
          wallet: account,
          name: tokenName.trim(),
          symbol: tokenSymbol.trim().toUpperCase(),
          totalSupply: supply.toString(),
          creatorAllocation: allocation.toString(),
          disclaimerAccepted: accepted,
        },
      });
      toast.message("Token deployment submitted. Verifying…");
      await verifyToken({ data: { listingId: selected.listing.id } });
      toast.success("Companion token verified and paired.");
    });
  }

  async function onVerifyToken() {
    if (!selected) return;
    await run("verify-token", async () => {
      await verifyToken({ data: { listingId: selected.listing.id } });
      toast.success("Token receipt reconciled.");
    });
  }

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-10 sm:px-6 lg:px-10">
      <header className="max-w-2xl">
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Launchpad</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Mint an Item Passport</h1>
        <p className="mt-3 text-muted-foreground">
          Everything here runs against {defaultChain.name} ({defaultChain.id}). Nothing is recorded in YARD SALE until
          the transaction receipt and contract event have been verified. Mainnet transactions stay disabled.
        </p>
      </header>

      {missing.length > 0 ? (
        <ConfigRequired
          className="mt-6"
          title="On-chain actions are not fully configured"
          reason={`Still required: ${missing.join("; ")}.`}
        />
      ) : null}

      <div className="mt-8 grid gap-6 lg:grid-cols-[22rem_1fr]">
        <aside className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-bold">Your listings</h2>
          {state.isLoading ? (
            <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
          ) : state.isError ? (
            <p className="mt-4 text-sm text-destructive">
              {state.error instanceof Error ? state.error.message : "Could not load your listings."}
            </p>
          ) : items.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              You have no listings yet.{" "}
              <Link to="/sell/new" className="underline underline-offset-4">
                List an item
              </Link>
              .
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {items.map((item) => {
                const active = item.listing.id === selectedId;
                return (
                  <li key={item.listing.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(item.listing.id)}
                      aria-current={active ? "true" : undefined}
                      className={`w-full rounded-lg border p-3 text-left transition ${
                        active ? "border-foreground" : "border-border hover:border-foreground/40"
                      }`}
                    >
                      <span className="block text-sm font-semibold">{item.listing.title || "Untitled listing"}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {item.passport?.status === "confirmed"
                          ? `Passport #${item.passport.token_id}`
                          : eligibilityLabel[item.eligibility.reason]}
                      </span>
                      {item.companionToken?.status === "confirmed" ? (
                        <span className="mt-2 inline-block">
                          <StatusChip tone="grass">Token paired</StatusChip>
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <div className="space-y-5">
          {!selected ? (
            <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
              Select a listing to see its passport steps.
            </p>
          ) : (
            <>
              <Step index={1} title="Freeze the Item Passport metadata" done={Boolean(passport)}>
                {!selected.eligibility.eligible && !passport ? (
                  <p className="text-muted-foreground">{eligibilityLabel[selected.eligibility.reason]}.</p>
                ) : null}
                {passport ? (
                  <div className="space-y-1">
                    <Field label="Metadata URI" value={passport.metadata_uri} />
                    <Field label="Metadata hash" value={passport.metadata_hash} />
                    <Field label="Terms hash" value={passport.terms_hash} />
                    <Field label="Listing key" value={passport.listing_key} />
                    <Field
                      label="Photo hashes"
                      value={
                        Array.isArray(passport.image_hashes)
                          ? (passport.image_hashes as { sha256: string }[]).map((i) => i.sha256).join("\n")
                          : "—"
                      }
                    />
                  </div>
                ) : null}
                <Button
                  onClick={onFreeze}
                  disabled={busy !== null || (!selected.eligibility.eligible && !passport) || passport?.status === "confirmed"}
                >
                  {busy === "freeze" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {passport ? "Re-freeze metadata" : "Freeze metadata"}
                </Button>
              </Step>

              <Step index={2} title="Wallet, network and transaction plan" done={Boolean(state.data?.wallet)}>
                <Field label="Linked wallet" value={state.data?.wallet ? shortAddress(state.data.wallet) : "None linked"} mono={false} />
                <Field label="Network" value={`${defaultChain.name} (${defaultChain.id})`} mono={false} />
                <Field label="Registry" value={publicEnv.assetRegistryAddress || "Not configured"} />
                <Field label="Factory" value={publicEnv.tokenFactoryAddress || "Not configured"} />
                <p className="text-muted-foreground">
                  Estimated steps: 1 network switch (free) → 1 mint transaction (gas) → receipt verification. A
                  companion token adds 1 more transaction.
                </p>
                {!state.data?.wallet ? (
                  <Button variant="outline" asChild>
                    <Link to="/settings">Link a wallet</Link>
                  </Button>
                ) : null}
              </Step>

              <Step index={3} title="Mint the Item Passport" done={passport?.status === "confirmed"}>
                {!registryReady ? (
                  <ConfigRequired
                    title="Registry contract address missing"
                    reason="Deploy YardSaleAssetRegistry to Robinhood testnet and set VITE_ASSET_REGISTRY_ADDRESS."
                  />
                ) : passport?.status === "confirmed" ? (
                  <div className="space-y-1">
                    <Field label="Token ID" value={String(passport.token_id)} />
                    <Field label="Owner" value={passport.wallet_address} />
                    <Field label="Block" value={String(passport.block_number ?? "—")} />
                    <a
                      className="inline-flex items-center gap-1 font-semibold underline underline-offset-4"
                      href={explorerTxUrl(passport.chain_id, passport.tx_hash ?? "")}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View mint on the explorer <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                ) : (
                  <>
                    {passport?.status === "submitted" ? (
                      <p className="text-muted-foreground">
                        A mint transaction is pending: <span className="font-mono text-xs">{passport.tx_hash}</span>
                      </p>
                    ) : null}
                    {passport?.status === "failed" ? (
                      <p className="text-destructive">{passport.failure_reason ?? "The last attempt failed."}</p>
                    ) : null}
                    <div className="flex flex-wrap gap-3">
                      <Button onClick={onMint} disabled={busy !== null || !passport || !state.data?.wallet}>
                        {busy === "mint" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Mint Item Passport
                      </Button>
                      {passport?.status === "submitted" ? (
                        <Button variant="outline" onClick={onVerifyMint} disabled={busy !== null}>
                          {busy === "verify-mint" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          Check the pending transaction
                        </Button>
                      ) : null}
                    </div>
                  </>
                )}
              </Step>

              <Step index={4} title="Companion token (optional)" done={companion?.status === "confirmed"}>
                {passport?.status !== "confirmed" ? (
                  <p className="text-muted-foreground">Available once the Item Passport is verified on-chain.</p>
                ) : companion?.status === "confirmed" ? (
                  <div className="space-y-1">
                    <Field label="Token" value={`${companion.name} (${companion.symbol})`} mono={false} />
                    <Field label="Address" value={companion.token_address ?? ""} />
                    <a
                      className="inline-flex items-center gap-1 font-semibold underline underline-offset-4"
                      href={explorerAddressUrl(companion.chain_id, companion.token_address ?? "")}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View token on the explorer <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <div>
                      <Link
                        className="font-semibold underline underline-offset-4"
                        to="/token/$address"
                        params={{ address: companion.token_address ?? "" }}
                      >
                        Open the token page to sell your tokens
                      </Link>
                    </div>
                    <p className="text-muted-foreground">One companion token per passport. This pairing is permanent.</p>

                  </div>
                ) : !factoryReady ? (
                  <ConfigRequired
                    title="Token factory address missing"
                    reason="Deploy YardTokenFactory to Robinhood testnet and set VITE_TOKEN_FACTORY_ADDRESS."
                  />
                ) : (
                  <>
                    {companion?.status === "submitted" ? (
                      <p className="text-muted-foreground">
                        A deployment is pending: <span className="font-mono text-xs">{companion.tx_hash}</span>
                      </p>
                    ) : null}
                    {companion?.status === "failed" ? (
                      <p className="text-destructive">{companion.failure_reason ?? "The last attempt failed."}</p>
                    ) : null}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="token-name">Token name</Label>
                        <Input id="token-name" value={tokenName} onChange={(e) => setTokenName(e.target.value)} />
                      </div>
                      <div>
                        <Label htmlFor="token-symbol">Symbol</Label>
                        <Input
                          id="token-symbol"
                          value={tokenSymbol}
                          onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())}
                        />
                      </div>
                      <div>
                        <Label htmlFor="token-supply">Fixed total supply (whole tokens)</Label>
                        <Input
                          id="token-supply"
                          inputMode="numeric"
                          value={tokenSupply}
                          onChange={(e) => setTokenSupply(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label htmlFor="token-allocation">Your allocation</Label>
                        <Input
                          id="token-allocation"
                          inputMode="numeric"
                          value={tokenAllocation}
                          onChange={(e) => setTokenAllocation(e.target.value)}
                        />
                      </div>
                    </div>
                    <label className="flex items-start gap-3 rounded-lg border border-border p-3">
                      <Checkbox
                        checked={accepted}
                        onCheckedChange={(value) => setAccepted(value === true)}
                        aria-label="Accept the companion token disclaimer"
                      />
                      <span className="text-sm text-muted-foreground">{COMPANION_TOKEN_DISCLAIMER}</span>
                    </label>
                    <div className="flex flex-wrap gap-3">
                      <Button
                        onClick={onCreateToken}
                        disabled={busy !== null || !accepted || !tokenName.trim() || !tokenSymbol.trim()}
                      >
                        {busy === "token" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Deploy companion token
                      </Button>
                      {companion?.status === "submitted" ? (
                        <Button variant="outline" onClick={onVerifyToken} disabled={busy !== null}>
                          {busy === "verify-token" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          Check the pending deployment
                        </Button>
                      ) : null}
                    </div>
                  </>
                )}
              </Step>

              <section className="rounded-xl border border-dashed border-border bg-muted/30 p-5">
                <div className="flex items-center gap-3">
                  <Lock aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-base font-bold">Uniswap liquidity</h2>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  Available after testnet validation and mainnet contract review.
                </p>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
