import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, ExternalLink, Lock, Loader2, RefreshCw, ShieldCheck, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfigRequired } from "@/components/site/ConfigRequired";
import { StatusChip } from "@/components/site/ListingCard";
import { explorerAddressUrl, explorerTokenUrl, explorerTxUrl } from "@/lib/chain";
import { shortAddress } from "@/lib/listing-meta";
import { ipfsGatewayUrl } from "@/lib/ipfs";
import {
  ATTESTATION_STATEMENTS,
  COMPANION_TOKEN_DISCLAIMER,
  LIQUIDITY_RISK_STATEMENTS,
  attestationComplete,
  eligibilityLabel,
  fromTokenUnits,
  toTokenUnits,
  validateTokenParams,
  type PossessionAttestation,
} from "@/lib/passport-metadata";
import { connectAccount, currentChainId, ensureChain, injectedProvider, sendTransaction } from "@/lib/wallet-client";
import {
  freezePassportMetadata,
  getLaunchpadState,
  prepareMint,
  prepareToken,
  recordMintSubmission,
  recordTokenSubmission,
  reconcileCompanionToken,
  reconcilePassport,
  resetStalledMint,
  resetStalledToken,
} from "@/lib/launchpad.functions";
import {
  prepareLiquidityStep,
  previewLiquidity,
  reconcileLiquidity,
  recordLiquidityStep,
  resetLiquidity,
  startLiquidity,
  type LiquidityStep,
} from "@/lib/liquidity.functions";

export const Route = createFileRoute("/_authenticated/launchpad")({
  head: () => ({
    meta: [
      { title: "Launchpad — mint an Item Passport | YARD SALE" },
      {
        name: "description",
        content:
          "Attest, freeze and mint a verifiable Item Passport on Robinhood Chain, then optionally launch a fixed-supply Companion Token and seed Uniswap liquidity.",
      },
      { property: "og:title", content: "YARD SALE Launchpad" },
      { property: "og:description", content: "Turn a listing into a verifiable Item Passport on Robinhood Chain." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Launchpad,
});

type LaunchpadData = Awaited<ReturnType<typeof getLaunchpadState>>;
type LaunchpadItem = LaunchpadData["items"][number];
type MintPreview = Extract<Awaited<ReturnType<typeof prepareMint>>, { alreadyMinted: false }>;
type TokenPreview = Extract<Awaited<ReturnType<typeof prepareToken>>, { alreadyCreated: false }>;
type LiquidityPreview = Awaited<ReturnType<typeof previewLiquidity>>;

const emptyAttestation: PossessionAttestation = {
  possession: false,
  rightToSell: false,
  accurate: false,
  notProhibited: false,
  understandsNoRights: false,
};

const LIQUIDITY_STEP_LABEL: Record<LiquidityStep, string> = {
  wrap: "Wrap ETH",
  approve_weth: "Approve WETH",
  approve_token: "Approve token",
  create_pool: "Create pool",
  mint: "Mint position",
  done: "Done",
};

/* ------------------------------------------------------------ UI helpers */

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

function Field({ label, value, mono = true }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[11rem_1fr]">
      <span className="text-muted-foreground">{label}</span>
      <span className={`break-all ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  );
}

function ExplorerLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="inline-flex items-center gap-1 font-semibold underline underline-offset-4" href={href} target="_blank" rel="noreferrer">
      {children} <ExternalLink className="h-3.5 w-3.5" />
    </a>
  );
}

function Spinner({ active }: { active: boolean }) {
  return active ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null;
}

function Problems({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
      {items.map((p) => (
        <li key={p} className="flex gap-2">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>{p}</span>
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------- page */

function Launchpad() {
  const queryClient = useQueryClient();
  const loadState = useServerFn(getLaunchpadState);
  const freeze = useServerFn(freezePassportMetadata);
  const planMint = useServerFn(prepareMint);
  const submitMint = useServerFn(recordMintSubmission);
  const verifyMint = useServerFn(reconcilePassport);
  const resetMint = useServerFn(resetStalledMint);
  const planToken = useServerFn(prepareToken);
  const submitToken = useServerFn(recordTokenSubmission);
  const verifyToken = useServerFn(reconcileCompanionToken);
  const resetToken = useServerFn(resetStalledToken);
  const previewLp = useServerFn(previewLiquidity);
  const startLp = useServerFn(startLiquidity);
  const prepareLp = useServerFn(prepareLiquidityStep);
  const recordLp = useServerFn(recordLiquidityStep);
  const verifyLp = useServerFn(reconcileLiquidity);
  const resetLp = useServerFn(resetLiquidity);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [walletChain, setWalletChain] = useState<number | null>(null);
  const [hasProvider, setHasProvider] = useState(true);

  const [attestation, setAttestation] = useState<PossessionAttestation>(emptyAttestation);
  const [mintPreview, setMintPreview] = useState<MintPreview | null>(null);

  const [tokenName, setTokenName] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState("");
  const [tokenSupply, setTokenSupply] = useState("1000000");
  const [tokenAllocation, setTokenAllocation] = useState("700000");
  const [accepted, setAccepted] = useState(false);
  const [tokenPreview, setTokenPreview] = useState<TokenPreview | null>(null);

  const [lpTokenAmount, setLpTokenAmount] = useState("");
  const [lpEthAmount, setLpEthAmount] = useState("0.05");
  const [lpSlippage, setLpSlippage] = useState("100");
  const [lpRisks, setLpRisks] = useState<boolean[]>(LIQUIDITY_RISK_STATEMENTS.map(() => false));
  const [lpPreview, setLpPreview] = useState<LiquidityPreview | null>(null);

  useEffect(() => {
    setHasProvider(Boolean(injectedProvider()));
    const provider = injectedProvider();
    if (!provider) return;
    provider
      .request({ method: "eth_accounts" })
      .then((accounts) => {
        const list = accounts as string[];
        if (list?.[0]) setAccount(list[0].toLowerCase());
      })
      .catch(() => undefined);
    currentChainId().then(setWalletChain).catch(() => undefined);
  }, []);

  const state = useQuery({
    queryKey: ["launchpad"],
    queryFn: () => loadState({ data: undefined }),
    refetchOnWindowFocus: false,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["launchpad"] });

  const items = state.data?.items ?? [];
  const selected: LaunchpadItem | null = items.find((item) => item.listing.id === selectedId) ?? null;
  const passport = selected?.passport ?? null;
  const companion = selected?.companionToken ?? null;
  const liquidity = selected?.liquidity ?? null;
  const health = state.data?.health ?? null;
  const lpInfra = state.data?.liquidityInfra ?? null;
  const chainId = state.data?.chainId ?? null;
  const chainName = state.data?.chainName ?? "Robinhood Chain";

  const linkedWallets = state.data?.wallets ?? [];
  const accountLinked = Boolean(account && linkedWallets.includes(account));
  const blockers = (health?.checks ?? []).filter((c) => !c.ok && c.severity === "blocker");
  const warnings = (health?.checks ?? []).filter((c) => !c.ok && c.severity === "warning");
  const chainReady = Boolean(health?.ready);

  const missing = useMemo(() => {
    const list: string[] = [];
    if (!hasProvider) list.push("a browser wallet extension (MetaMask, Rabby or similar)");
    if (state.data && linkedWallets.length === 0) list.push("a wallet linked to this account in Settings");
    if (account && !accountLinked) list.push(`the connected wallet ${shortAddress(account)} to be linked to this account (or switch to a linked one)`);
    return list;
  }, [hasProvider, state.data, linkedWallets.length, account, accountLinked]);

  // Reset previews when the selection changes; a preview is only valid for the listing it was built for.
  useEffect(() => {
    setMintPreview(null);
    setTokenPreview(null);
    setLpPreview(null);
    setAttestation(emptyAttestation);
  }, [selectedId]);

  async function run<T>(key: string, fn: () => Promise<T>) {
    setBusy(key);
    try {
      await fn();
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong.";
      toast.error(message.length > 400 ? `${message.slice(0, 400)}…` : message);
    } finally {
      setBusy(null);
    }
  }

  async function ensureWallet(): Promise<string> {
    const acct = (await connectAccount()).toLowerCase();
    setAccount(acct);
    if (!linkedWallets.includes(acct)) {
      throw new Error(`Wallet ${shortAddress(acct)} is not linked to this account. Link it in Settings or switch wallets.`);
    }
    if (!chainId) throw new Error("The active chain is not known yet. Reload the page.");
    await ensureChain(chainId);
    setWalletChain(chainId);
    return acct;
  }

  /* ------------------------------------------------------------ actions */

  async function onConnect() {
    await run("connect", async () => {
      const acct = (await connectAccount()).toLowerCase();
      setAccount(acct);
      setWalletChain(await currentChainId());
    });
  }

  async function onSwitchChain() {
    if (!chainId) return;
    await run("switch", async () => {
      await ensureChain(chainId);
      setWalletChain(chainId);
      toast.success(`Wallet is on ${chainName} (${chainId}).`);
    });
  }

  async function onFreeze() {
    if (!selected) return;
    await run("freeze", async () => {
      if (!attestationComplete(attestation)) throw new Error("Confirm every possession statement first.");
      await freeze({ data: { listingId: selected.listing.id, attestation } });
      setMintPreview(null);
      toast.success("Metadata frozen, hashed and stored.");
    });
  }

  async function onPrepareMint() {
    if (!selected) return;
    await run("prepare-mint", async () => {
      const wallet = await ensureWallet();
      const preview = await planMint({ data: { listingId: selected.listing.id, wallet } });
      if (preview.alreadyMinted) {
        toast.message(`A passport (#${preview.tokenId}) already exists on-chain for this listing. Recovering it…`);
        await verifyMint({ data: { listingId: selected.listing.id } });
        return;
      }
      setMintPreview(preview);
    });
  }

  async function onMint() {
    if (!selected || !mintPreview) return;
    await run("mint", async () => {
      const wallet = await ensureWallet();
      if (wallet !== mintPreview.wallet.toLowerCase()) throw new Error("The connected wallet changed. Prepare the transaction again.");
      const hash = await sendTransaction({
        from: wallet,
        to: mintPreview.to,
        data: mintPreview.data,
        gas: mintPreview.gasEstimate ? `0x${((BigInt(mintPreview.gasEstimate) * 120n) / 100n).toString(16)}` : undefined,
      });
      await submitMint({ data: { listingId: selected.listing.id, txHash: hash, wallet } });
      setMintPreview(null);
      toast.message("Mint submitted. Waiting for the receipt…");
      const result = await verifyMint({ data: { listingId: selected.listing.id } });
      if (result.outcome === "confirmed") toast.success("Item Passport verified on-chain.");
      else if (result.outcome === "failed") toast.error(result.message);
      else toast.message(result.message);
    });
  }

  async function onVerifyMint() {
    if (!selected) return;
    await run("verify-mint", async () => {
      const result = await verifyMint({ data: { listingId: selected.listing.id } });
      if (result.outcome === "confirmed") toast.success(result.message);
      else if (result.outcome === "failed") toast.error(result.message);
      else toast.message(result.message);
    });
  }

  async function onResetMint() {
    if (!selected) return;
    await run("reset-mint", async () => {
      await resetMint({ data: { listingId: selected.listing.id } });
      toast.success("The stalled mint was cleared. You can prepare a new transaction.");
    });
  }

  function tokenInput() {
    const supply = toTokenUnits(tokenSupply);
    const allocation = toTokenUnits(tokenAllocation);
    const problem = validateTokenParams({ name: tokenName.trim(), symbol: tokenSymbol.trim().toUpperCase(), totalSupply: supply, creatorAllocation: allocation });
    if (problem) throw new Error(problem);
    return {
      name: tokenName.trim(),
      symbol: tokenSymbol.trim().toUpperCase(),
      totalSupply: supply.toString(),
      creatorAllocation: allocation.toString(),
      disclaimerAccepted: accepted,
    };
  }

  async function onPrepareToken() {
    if (!selected) return;
    await run("prepare-token", async () => {
      if (!accepted) throw new Error("Accept the no-rights statement first.");
      const wallet = await ensureWallet();
      const preview = await planToken({ data: { listingId: selected.listing.id, wallet, ...tokenInput() } });
      if (preview.alreadyCreated) {
        toast.message(`A companion token already exists at ${preview.tokenAddress}. Recovering it…`);
        await verifyToken({ data: { listingId: selected.listing.id } });
        return;
      }
      setTokenPreview(preview);
    });
  }

  async function onCreateToken() {
    if (!selected || !tokenPreview) return;
    await run("token", async () => {
      const wallet = await ensureWallet();
      if (wallet !== tokenPreview.wallet.toLowerCase()) throw new Error("The connected wallet changed. Prepare the deployment again.");
      const input = tokenInput();
      if (input.totalSupply !== tokenPreview.args.totalSupply || input.creatorAllocation !== tokenPreview.args.creatorAllocation || input.name !== tokenPreview.args.name || input.symbol !== tokenPreview.args.symbol) {
        throw new Error("The token details changed after the preview. Prepare the deployment again.");
      }
      const hash = await sendTransaction({
        from: wallet,
        to: tokenPreview.to,
        data: tokenPreview.data,
        gas: tokenPreview.gasEstimate ? `0x${((BigInt(tokenPreview.gasEstimate) * 120n) / 100n).toString(16)}` : undefined,
      });
      await submitToken({ data: { listingId: selected.listing.id, txHash: hash, wallet, ...input } });
      setTokenPreview(null);
      toast.message("Deployment submitted. Verifying bytecode, supply, allocation and pairing…");
      const result = await verifyToken({ data: { listingId: selected.listing.id } });
      if (result.outcome === "confirmed") toast.success(result.message);
      else if (result.outcome === "failed") toast.error(result.message);
      else toast.message(result.message);
    });
  }

  async function onVerifyToken() {
    if (!selected) return;
    await run("verify-token", async () => {
      const result = await verifyToken({ data: { listingId: selected.listing.id } });
      if (result.outcome === "confirmed") toast.success(result.message);
      else if (result.outcome === "failed") toast.error(result.message);
      else toast.message(result.message);
    });
  }

  async function onResetToken() {
    if (!selected) return;
    await run("reset-token", async () => {
      await resetToken({ data: { listingId: selected.listing.id } });
      toast.success("The stalled deployment was cleared.");
    });
  }

  function lpInput() {
    const slippageBps = Number.parseInt(lpSlippage, 10);
    if (!Number.isInteger(slippageBps)) throw new Error("Slippage must be a whole number of basis points.");
    if (!/^\d+(\.\d+)?$/.test(lpTokenAmount) || !/^\d+(\.\d+)?$/.test(lpEthAmount)) throw new Error("Amounts must be positive decimal numbers.");
    return { tokenAmount: lpTokenAmount, ethAmount: lpEthAmount, slippageBps };
  }

  async function onPreviewLiquidity() {
    if (!selected) return;
    await run("lp-preview", async () => {
      const wallet = await ensureWallet();
      setLpPreview(await previewLp({ data: { listingId: selected.listing.id, wallet, ...lpInput() } }));
    });
  }

  async function onStartLiquidity() {
    if (!selected || !lpPreview) return;
    await run("lp-start", async () => {
      if (!lpRisks.every(Boolean)) throw new Error("Accept every liquidity risk statement first.");
      const wallet = await ensureWallet();
      await startLp({ data: { listingId: selected.listing.id, wallet, ...lpInput(), risksAccepted: true } });
      setLpPreview(null);
      toast.success("Liquidity plan saved. Continue to sign each step.");
    });
  }

  /** Runs the next liquidity step: prepares it, asks the wallet to sign if needed, then verifies the result. */
  async function onContinueLiquidity() {
    if (!selected) return;
    await run("lp-continue", async () => {
      const wallet = await ensureWallet();
      for (let i = 0; i < 6; i += 1) {
        const prep = await prepareLp({ data: { listingId: selected.listing.id } });
        if (prep.skip) {
          toast.message(`${LIQUIDITY_STEP_LABEL[prep.step]}: ${prep.description}`);
          continue;
        }
        if (!prep.pendingTxHash) {
          if (!prep.to || !prep.data) throw new Error("The step did not produce a transaction.");
          const hash = await sendTransaction({ from: wallet, to: prep.to, data: prep.data, value: prep.value ?? undefined });
          await recordLp({ data: { listingId: selected.listing.id, step: prep.step, txHash: hash } });
          toast.message(`${LIQUIDITY_STEP_LABEL[prep.step]} submitted. Waiting for the receipt…`);
        }
        const result = await verifyLp({ data: { listingId: selected.listing.id } });
        if (result.outcome === "confirmed") {
          toast.success(result.message);
          return;
        }
        if (result.outcome === "failed") throw new Error(result.message);
        if (result.outcome === "pending") {
          toast.message(result.message);
          return;
        }
        toast.message(result.message);
        await refresh();
      }
    });
  }

  async function onVerifyLiquidity() {
    if (!selected) return;
    await run("lp-verify", async () => {
      const result = await verifyLp({ data: { listingId: selected.listing.id } });
      if (result.outcome === "confirmed") toast.success(result.message);
      else if (result.outcome === "failed") toast.error(result.message);
      else toast.message(result.message);
    });
  }

  async function onResetLiquidity() {
    if (!selected) return;
    await run("lp-reset", async () => {
      await resetLp({ data: { listingId: selected.listing.id } });
      toast.success("The liquidity plan was cleared. Any approvals already on-chain remain in your wallet.");
    });
  }

  /* ------------------------------------------------------------- render */

  const walletOnChain = walletChain !== null && chainId !== null && walletChain === chainId;
  const canSign = chainReady && accountLinked && missing.length === 0;
  const imageHashes = Array.isArray(passport?.image_hashes) ? (passport?.image_hashes as { sha256: string }[]) : [];
  const attested = passport?.attestation as PossessionAttestation | null | undefined;
  const stalledAge = passport?.submitted_at ? Date.now() - new Date(passport.submitted_at).getTime() : 0;

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-10 sm:px-6 lg:px-10">
      <header className="max-w-3xl">
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Launchpad</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Mint an Item Passport</h1>
        <p className="mt-3 text-muted-foreground">
          Everything here runs against <strong>{chainName}</strong>
          {chainId ? ` (${chainId})` : ""}. Every value is shown before you sign, every transaction is signed by your own wallet,
          and nothing is recorded in YARD SALE until the receipt, event and resulting contract state have been verified.
        </p>
        {health && health.mainnetRequested && !health.mainnetEnabled ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Mainnet (4663) is requested but <span className="font-mono text-xs">VITE_ENABLE_MAINNET</span> is false, so this page is
            running against the testnet. Mainnet actions stay disabled until the deployment checks on{" "}
            <Link to="/status" className="underline underline-offset-4">
              Status
            </Link>{" "}
            pass.
          </p>
        ) : null}
      </header>

      {state.isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">Checking the deployment and your listings…</p>
      ) : null}

      {blockers.length > 0 ? (
        <ConfigRequired
          className="mt-6"
          title="On-chain actions are not available yet"
          reason={blockers.map((b) => `${b.label}: ${b.detail}`).join(" ")}
        />
      ) : null}
      {missing.length > 0 && blockers.length === 0 ? (
        <ConfigRequired className="mt-6" title="Wallet requirements" reason={`Still required: ${missing.join("; ")}.`} />
      ) : null}
      {warnings.length > 0 ? (
        <div className="mt-4 rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          <p className="font-semibold text-foreground">Warnings</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {warnings.map((w) => (
              <li key={w.key}>
                {w.label}: {w.detail}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-8 grid gap-6 lg:grid-cols-[22rem_1fr]">
        <aside className="space-y-5">
          <section className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2">
              <Wallet aria-hidden="true" className="h-4 w-4" />
              <h2 className="text-base font-bold">Wallet</h2>
            </div>
            <div className="mt-3 space-y-2 text-sm">
              <Field label="Connected" value={account ? shortAddress(account) : "Not connected"} mono={false} />
              <Field
                label="Linked"
                value={account ? (accountLinked ? "Yes" : "No — link it in Settings") : linkedWallets.length ? `${linkedWallets.length} wallet(s)` : "None"}
                mono={false}
              />
              <Field label="Wallet chain" value={walletChain === null ? "Unknown" : walletOnChain ? `${chainName} (${walletChain})` : `Chain ${walletChain} — switch needed`} mono={false} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={onConnect} disabled={busy !== null || !hasProvider}>
                <Spinner active={busy === "connect"} />
                {account ? "Reconnect" : "Connect wallet"}
              </Button>
              {account && !walletOnChain && chainId ? (
                <Button size="sm" variant="outline" onClick={onSwitchChain} disabled={busy !== null}>
                  <Spinner active={busy === "switch"} />
                  Switch to {chainName}
                </Button>
              ) : null}
              {linkedWallets.length === 0 || (account && !accountLinked) ? (
                <Button size="sm" variant="ghost" asChild>
                  <Link to="/settings">Link a wallet</Link>
                </Button>
              ) : null}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-base font-bold">Your listings</h2>
            {state.isError ? (
              <p className="mt-4 text-sm text-destructive">{state.error instanceof Error ? state.error.message : "Could not load your listings."}</p>
            ) : !state.isLoading && items.length === 0 ? (
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
                        className={`w-full rounded-lg border p-3 text-left transition ${active ? "border-foreground" : "border-border hover:border-foreground/40"}`}
                      >
                        <span className="block text-sm font-semibold">{item.listing.title || "Untitled listing"}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {item.passport?.status === "confirmed"
                            ? `Passport #${item.passport.token_id}`
                            : item.passport?.status === "submitted"
                              ? "Mint pending"
                              : item.passport
                                ? "Metadata frozen"
                                : eligibilityLabel[item.eligibility.reason]}
                        </span>
                        <span className="mt-2 flex flex-wrap gap-1">
                          {item.companionToken?.status === "confirmed" ? <StatusChip tone="grass">Token paired</StatusChip> : null}
                          {item.liquidity?.status === "confirmed" ? <StatusChip tone="grass">Liquidity live</StatusChip> : null}
                          {item.liquidity && item.liquidity.status !== "confirmed" ? <StatusChip tone="warning">Liquidity in progress</StatusChip> : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </aside>

        <div className="space-y-5">
          {!selected ? (
            <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">Select a listing to see its passport steps.</p>
          ) : (
            <>
              {/* ------------------------------------------------ Step 1 */}
              <Step index={1} title="Attest and freeze the Item Passport metadata" done={Boolean(passport)}>
                {!selected.eligibility.eligible && !passport ? (
                  <p className="text-muted-foreground">{eligibilityLabel[selected.eligibility.reason]}.</p>
                ) : null}

                {passport ? (
                  <div className="space-y-1">
                    <Field label="Metadata URI" value={passport.metadata_uri} />
                    {passport.ipfs_cid ? (
                      <Field
                        label="IPFS"
                        value={
                          <>
                            {passport.ipfs_cid}{" "}
                            <a className="underline underline-offset-4" href={ipfsGatewayUrl(`ipfs://${passport.ipfs_cid}`)} target="_blank" rel="noreferrer">
                              open via gateway
                            </a>
                          </>
                        }
                      />
                    ) : (
                      <Field label="IPFS" value="Not pinned (no PINATA_JWT configured) — metadata is stored in YARD SALE storage and its hash is on-chain" mono={false} />
                    )}
                    {passport.storage_url ? <Field label="Storage copy" value={passport.storage_url} /> : null}
                    <Field label="Metadata hash" value={passport.metadata_hash} />
                    <Field label="Terms hash" value={passport.terms_hash} />
                    <Field label="Listing key" value={passport.listing_key} />
                    <Field label="Photo hashes" value={imageHashes.length ? imageHashes.map((i) => i.sha256).join("\n") : "—"} />
                    <Field label="Attested" value={attested && attestationComplete(attested) ? `All ${ATTESTATION_STATEMENTS.length} statements confirmed` : "Incomplete"} mono={false} />
                    <Field label="Target" value={`${passport.chain_id} · ${passport.contract_address}`} />
                  </div>
                ) : null}

                {passport?.status !== "confirmed" && (selected.eligibility.eligible || passport) ? (
                  <fieldset className="space-y-2 rounded-lg border border-border p-3">
                    <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Possession attestation</legend>
                    {ATTESTATION_STATEMENTS.map((s) => (
                      <label key={s.key} className="flex items-start gap-3">
                        <Checkbox
                          checked={attestation[s.key]}
                          onCheckedChange={(value) => setAttestation((a) => ({ ...a, [s.key]: value === true }))}
                          aria-label={s.text}
                        />
                        <span className="text-sm">{s.text}</span>
                      </label>
                    ))}
                  </fieldset>
                ) : null}

                {passport?.status !== "confirmed" ? (
                  <Button
                    onClick={onFreeze}
                    disabled={busy !== null || !chainReady || (!selected.eligibility.eligible && !passport) || !attestationComplete(attestation) || passport?.status === "submitted"}
                  >
                    <Spinner active={busy === "freeze"} />
                    {passport ? "Re-freeze metadata" : "Freeze metadata"}
                  </Button>
                ) : null}
                {passport?.status === "submitted" ? <p className="text-muted-foreground">Metadata is locked while a mint is pending.</p> : null}
              </Step>

              {/* ------------------------------------------------ Step 2 */}
              <Step index={2} title="Review and mint the Item Passport" done={passport?.status === "confirmed"}>
                {!passport ? (
                  <p className="text-muted-foreground">Freeze the metadata first.</p>
                ) : passport.status === "confirmed" ? (
                  <div className="space-y-1">
                    <Field label="Token ID" value={String(passport.token_id)} />
                    <Field label="Registry" value={passport.contract_address} />
                    <Field label="Owner" value={passport.wallet_address} />
                    <Field label="Block" value={String(passport.block_number ?? "—")} />
                    <Field label="Transaction" value={passport.tx_hash ?? "—"} />
                    <div className="flex flex-wrap gap-4 pt-1">
                      <ExplorerLink href={explorerTxUrl(passport.chain_id, passport.tx_hash ?? "")}>Mint transaction</ExplorerLink>
                      <ExplorerLink href={explorerAddressUrl(passport.chain_id, passport.contract_address)}>Registry contract</ExplorerLink>
                    </div>
                  </div>
                ) : (
                  <>
                    <Field label="Network" value={`${chainName} (${chainId ?? "—"})`} mono={false} />
                    <Field label="Registry" value={health?.registry ?? "Not configured"} />
                    <Field label="Signer" value={account ? shortAddress(account) : "Connect your wallet"} mono={false} />

                    {passport.status === "submitted" ? (
                      <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
                        <p>
                          A mint transaction is pending: <span className="font-mono text-xs">{passport.tx_hash}</span>
                        </p>
                        {passport.tx_hash ? <ExplorerLink href={explorerTxUrl(passport.chain_id, passport.tx_hash)}>Watch it on the explorer</ExplorerLink> : null}
                        <div className="flex flex-wrap gap-3 pt-1">
                          <Button variant="outline" onClick={onVerifyMint} disabled={busy !== null}>
                            <Spinner active={busy === "verify-mint"} />
                            Check the pending transaction
                          </Button>
                          {stalledAge > 5 * 60_000 ? (
                            <Button variant="ghost" onClick={onResetMint} disabled={busy !== null}>
                              <Spinner active={busy === "reset-mint"} />
                              Clear stalled mint
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                    {passport.status === "failed" ? (
                      <div className="space-y-2">
                        <p className="text-destructive">{passport.failure_reason ?? "The last attempt failed."}</p>
                        <Button variant="ghost" size="sm" onClick={onResetMint} disabled={busy !== null}>
                          <Spinner active={busy === "reset-mint"} />
                          Clear and try again
                        </Button>
                      </div>
                    ) : null}

                    {mintPreview ? (
                      <div className="space-y-1 rounded-lg border border-border p-3">
                        <p className="font-semibold">You are about to sign</p>
                        <Field label="Function" value="mintPassport(to, listingId, metadataURI, metadataHash, termsHash)" />
                        <Field label="Contract" value={mintPreview.to} />
                        <Field label="to" value={mintPreview.args.to} />
                        <Field label="listingId" value={mintPreview.args.listingId} />
                        <Field label="metadataURI" value={mintPreview.args.metadataURI} />
                        <Field label="metadataHash" value={mintPreview.args.metadataHash} />
                        <Field label="termsHash" value={mintPreview.args.termsHash} />
                        <Field label="Estimated gas" value={mintPreview.gasEstimate ?? `Unavailable — ${mintPreview.gasError ?? "estimate failed"}`} />
                        <Field label="Estimated fee" value={mintPreview.feeEstimateEth ? `${mintPreview.feeEstimateEth} ETH` : "—"} />
                        <Field label="Your balance" value={`${mintPreview.balanceEth} ETH`} />
                        <Field label="Calldata" value={mintPreview.data} />
                        {mintPreview.insufficientFunds ? <Problems items={["Your wallet does not hold enough ETH to pay for this transaction."]} /> : null}
                        {mintPreview.gasError && !mintPreview.insufficientFunds ? <Problems items={[`The node rejected a simulation of this call: ${mintPreview.gasError}`]} /> : null}
                      </div>
                    ) : null}

                    {passport.status !== "submitted" ? (
                      <div className="flex flex-wrap gap-3">
                        {!mintPreview ? (
                          <Button onClick={onPrepareMint} disabled={busy !== null || !canSign || passport.status === "failed"}>
                            <Spinner active={busy === "prepare-mint"} />
                            Prepare the mint
                          </Button>
                        ) : (
                          <>
                            <Button onClick={onMint} disabled={busy !== null || !canSign || mintPreview.insufficientFunds}>
                              <Spinner active={busy === "mint"} />
                              Sign and mint
                            </Button>
                            <Button variant="ghost" onClick={() => setMintPreview(null)} disabled={busy !== null}>
                              Cancel
                            </Button>
                          </>
                        )}
                      </div>
                    ) : null}
                  </>
                )}
              </Step>

              {/* ------------------------------------------------ Step 3 */}
              <Step index={3} title="Companion Token (optional)" done={companion?.status === "confirmed"}>
                {passport?.status !== "confirmed" ? (
                  <p className="text-muted-foreground">Available once the Item Passport is verified on-chain.</p>
                ) : companion?.status === "confirmed" ? (
                  <div className="space-y-1">
                    <Field label="Token" value={`${companion.name} (${companion.symbol})`} mono={false} />
                    <Field label="Address" value={companion.token_address ?? ""} />
                    <Field label="Fixed supply" value={`${fromTokenUnits(String(companion.total_supply))} ${companion.symbol}`} mono={false} />
                    <Field label="Your allocation" value={`${fromTokenUnits(String(companion.creator_allocation))} ${companion.symbol}`} mono={false} />
                    <Field label="Implementation" value={companion.implementation_address ?? "—"} />
                    <Field label="Bytecode hash" value={companion.bytecode_hash ?? "—"} />
                    <Field label="Paired passport" value={`#${passport.token_id}`} mono={false} />
                    <div className="flex flex-wrap gap-4 pt-1">
                      <ExplorerLink href={explorerTokenUrl(companion.chain_id, companion.token_address ?? "")}>Token on the explorer</ExplorerLink>
                      {companion.tx_hash ? <ExplorerLink href={explorerTxUrl(companion.chain_id, companion.tx_hash)}>Deployment transaction</ExplorerLink> : null}
                      <Link className="font-semibold underline underline-offset-4" to="/token/$address" params={{ address: companion.token_address ?? "" }}>
                        Open the token page to sell your tokens
                      </Link>
                    </div>
                    <p className="pt-1 text-muted-foreground">One companion token per passport. This pairing is permanent and enforced by the registry.</p>
                  </div>
                ) : (
                  <>
                    {companion?.status === "submitted" ? (
                      <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
                        <p>
                          A deployment is pending: <span className="font-mono text-xs">{companion.tx_hash}</span>
                        </p>
                        <div className="flex flex-wrap gap-3">
                          <Button variant="outline" onClick={onVerifyToken} disabled={busy !== null}>
                            <Spinner active={busy === "verify-token"} />
                            Check the pending deployment
                          </Button>
                          <Button variant="ghost" onClick={onResetToken} disabled={busy !== null}>
                            <Spinner active={busy === "reset-token"} />
                            Clear stalled deployment
                          </Button>
                        </div>
                      </div>
                    ) : null}
                    {companion?.status === "failed" ? (
                      <div className="space-y-2">
                        <p className="text-destructive">{companion.failure_reason ?? "The last attempt failed."}</p>
                        <Button variant="ghost" size="sm" onClick={onResetToken} disabled={busy !== null}>
                          <Spinner active={busy === "reset-token"} />
                          Clear and try again
                        </Button>
                      </div>
                    ) : null}

                    {companion?.status !== "submitted" ? (
                      <>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <Label htmlFor="token-name">Token name (max 64)</Label>
                            <Input id="token-name" maxLength={64} value={tokenName} onChange={(e) => setTokenName(e.target.value)} disabled={Boolean(tokenPreview)} />
                          </div>
                          <div>
                            <Label htmlFor="token-symbol">Symbol (max 16)</Label>
                            <Input id="token-symbol" maxLength={16} value={tokenSymbol} onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())} disabled={Boolean(tokenPreview)} />
                          </div>
                          <div>
                            <Label htmlFor="token-supply">Fixed total supply (whole tokens, immutable)</Label>
                            <Input id="token-supply" inputMode="numeric" value={tokenSupply} onChange={(e) => setTokenSupply(e.target.value)} disabled={Boolean(tokenPreview)} />
                          </div>
                          <div>
                            <Label htmlFor="token-allocation">Your allocation (rest goes to the treasury)</Label>
                            <Input id="token-allocation" inputMode="numeric" value={tokenAllocation} onChange={(e) => setTokenAllocation(e.target.value)} disabled={Boolean(tokenPreview)} />
                          </div>
                        </div>
                        <label className="flex items-start gap-3 rounded-lg border border-border p-3">
                          <Checkbox checked={accepted} onCheckedChange={(value) => setAccepted(value === true)} aria-label="Accept the companion token disclaimer" disabled={Boolean(tokenPreview)} />
                          <span className="text-sm text-muted-foreground">{COMPANION_TOKEN_DISCLAIMER}</span>
                        </label>

                        {tokenPreview ? (
                          <div className="space-y-1 rounded-lg border border-border p-3">
                            <p className="font-semibold">You are about to sign</p>
                            <Field label="Function" value="createCompanionToken(passportTokenId, name, symbol, totalSupply, creatorAllocation)" />
                            <Field label="Factory" value={tokenPreview.to} />
                            <Field label="Implementation" value={tokenPreview.implementation} />
                            <Field label="Predicted token" value={tokenPreview.predictedAddress} />
                            <Field label="passportTokenId" value={tokenPreview.args.passportTokenId} />
                            <Field label="name / symbol" value={`${tokenPreview.args.name} / ${tokenPreview.args.symbol}`} mono={false} />
                            <Field label="totalSupply" value={`${fromTokenUnits(tokenPreview.args.totalSupply)} (${tokenPreview.args.totalSupply} base units)`} />
                            <Field label="creatorAllocation" value={`${fromTokenUnits(tokenPreview.args.creatorAllocation)} → ${shortAddress(tokenPreview.wallet)}`} />
                            <Field label="treasury" value={`${fromTokenUnits(tokenPreview.args.treasuryAllocation)} → treasury`} />
                            <Field label="Estimated gas" value={tokenPreview.gasEstimate ?? `Unavailable — ${tokenPreview.gasError ?? "estimate failed"}`} />
                            <Field label="Estimated fee" value={tokenPreview.feeEstimateEth ? `${tokenPreview.feeEstimateEth} ETH` : "—"} />
                            <Field label="Your balance" value={`${tokenPreview.balanceEth} ETH`} />
                            {tokenPreview.insufficientFunds ? <Problems items={["Your wallet does not hold enough ETH to pay for this transaction."]} /> : null}
                            {tokenPreview.gasError && !tokenPreview.insufficientFunds ? <Problems items={[`The node rejected a simulation of this call: ${tokenPreview.gasError}`]} /> : null}
                          </div>
                        ) : null}

                        <div className="flex flex-wrap gap-3">
                          {!tokenPreview ? (
                            <Button onClick={onPrepareToken} disabled={busy !== null || !canSign || !accepted || !tokenName.trim() || !tokenSymbol.trim() || companion?.status === "failed"}>
                              <Spinner active={busy === "prepare-token"} />
                              Prepare the deployment
                            </Button>
                          ) : (
                            <>
                              <Button onClick={onCreateToken} disabled={busy !== null || !canSign || tokenPreview.insufficientFunds}>
                                <Spinner active={busy === "token"} />
                                Sign and deploy
                              </Button>
                              <Button variant="ghost" onClick={() => setTokenPreview(null)} disabled={busy !== null}>
                                Edit details
                              </Button>
                            </>
                          )}
                        </div>
                      </>
                    ) : null}
                  </>
                )}
              </Step>

              {/* ------------------------------------------------ Step 4 */}
              {!lpInfra?.available ? (
                <section className="rounded-xl border border-dashed border-border bg-muted/30 p-5">
                  <div className="flex items-center gap-3">
                    <Lock aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                    <h2 className="text-base font-bold">Uniswap liquidity</h2>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">Available after testnet validation and mainnet contract review.</p>
                  {lpInfra ? (
                    <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {lpInfra.checks
                        .filter((c) => !c.ok)
                        .map((c) => (
                          <li key={c.key}>
                            {c.label}: {c.detail}
                          </li>
                        ))}
                    </ul>
                  ) : null}
                </section>
              ) : (
                <Step index={4} title="Uniswap v3 liquidity (optional, mainnet)" done={liquidity?.status === "confirmed"}>
                  {companion?.status !== "confirmed" ? (
                    <p className="text-muted-foreground">Available once the Companion Token is verified and paired.</p>
                  ) : liquidity?.status === "confirmed" ? (
                    <div className="space-y-1">
                      <Field label="Pool" value={liquidity.pool_address ?? "—"} />
                      <Field label="Position NFT" value={`#${liquidity.position_token_id} (in your wallet)`} mono={false} />
                      <Field label="Liquidity" value={liquidity.liquidity ?? "—"} />
                      <Field label="Fee tier" value={`${liquidity.fee_tier / 10_000}%`} mono={false} />
                      <Field label="Range" value={`Full range (ticks ${liquidity.tick_lower} to ${liquidity.tick_upper})`} mono={false} />
                      <div className="flex flex-wrap gap-4 pt-1">
                        {liquidity.pool_address ? <ExplorerLink href={explorerAddressUrl(liquidity.chain_id, liquidity.pool_address)}>Pool on the explorer</ExplorerLink> : null}
                        {liquidity.mint_tx_hash ? <ExplorerLink href={explorerTxUrl(liquidity.chain_id, liquidity.mint_tx_hash)}>Position mint transaction</ExplorerLink> : null}
                        {liquidity.pool_tx_hash ? <ExplorerLink href={explorerTxUrl(liquidity.chain_id, liquidity.pool_tx_hash)}>Pool creation transaction</ExplorerLink> : null}
                      </div>
                      <p className="pt-1 text-muted-foreground">
                        Liquidity is not locked. The position NFT stays in your wallet; removing it is entirely up to you and visible to everyone.
                      </p>
                    </div>
                  ) : liquidity ? (
                    <>
                      <ol className="flex flex-wrap gap-2 text-xs">
                        {(["wrap", "approve_weth", "approve_token", "create_pool", "mint"] as LiquidityStep[]).map((s, i) => {
                          const order = ["wrap", "approve_weth", "approve_token", "create_pool", "mint", "done"];
                          const current = order.indexOf(liquidity.step);
                          const done = i < current;
                          const active = i === current;
                          return (
                            <li key={s} className={`rounded-full border px-2.5 py-1 ${done ? "border-transparent bg-primary text-primary-foreground" : active ? "border-foreground font-semibold" : "border-border text-muted-foreground"}`}>
                              {i + 1}. {LIQUIDITY_STEP_LABEL[s]}
                            </li>
                          );
                        })}
                      </ol>
                      <div className="space-y-1">
                        <Field label="Deposit" value={`${fromTokenUnits(liquidity.token_amount)} ${companion.symbol} + ${fromTokenUnits(liquidity.eth_amount)} ETH`} mono={false} />
                        <Field label="Slippage" value={`${liquidity.slippage_bps / 100}%`} mono={false} />
                        <Field label="Position manager" value={liquidity.position_manager} />
                        {liquidity.pool_address ? <Field label="Pool" value={liquidity.pool_address} /> : null}
                        {liquidity.failure_reason ? <p className="text-destructive">{liquidity.failure_reason}</p> : null}
                      </div>
                      <div className="flex flex-wrap gap-3">
                        <Button onClick={onContinueLiquidity} disabled={busy !== null || !canSign}>
                          <Spinner active={busy === "lp-continue"} />
                          {liquidity.status === "failed" ? "Retry the current step" : "Continue: sign the next step"}
                        </Button>
                        <Button variant="outline" onClick={onVerifyLiquidity} disabled={busy !== null}>
                          <Spinner active={busy === "lp-verify"} />
                          <RefreshCw className="mr-2 h-3.5 w-3.5" />
                          Check pending transaction
                        </Button>
                        {!liquidity.mint_tx_hash ? (
                          <Button variant="ghost" onClick={onResetLiquidity} disabled={busy !== null}>
                            <Spinner active={busy === "lp-reset"} />
                            Abandon plan
                          </Button>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-muted-foreground">
                        Seeds a full-range 0.3% {companion.symbol}/WETH pool through the official Uniswap v3 deployment on Robinhood Chain. Five wallet
                        signatures at most: wrap, two exact approvals, pool creation and the position mint.
                      </p>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <Label htmlFor="lp-token">{companion.symbol} to deposit</Label>
                          <Input id="lp-token" inputMode="decimal" value={lpTokenAmount} onChange={(e) => setLpTokenAmount(e.target.value)} placeholder={fromTokenUnits(String(companion.creator_allocation))} disabled={Boolean(lpPreview)} />
                        </div>
                        <div>
                          <Label htmlFor="lp-eth">ETH to deposit</Label>
                          <Input id="lp-eth" inputMode="decimal" value={lpEthAmount} onChange={(e) => setLpEthAmount(e.target.value)} disabled={Boolean(lpPreview)} />
                        </div>
                        <div>
                          <Label htmlFor="lp-slippage">Slippage (basis points)</Label>
                          <Input id="lp-slippage" inputMode="numeric" value={lpSlippage} onChange={(e) => setLpSlippage(e.target.value)} disabled={Boolean(lpPreview)} />
                        </div>
                      </div>

                      {lpPreview ? (
                        <div className="space-y-1 rounded-lg border border-border p-3">
                          <p className="font-semibold">Opening terms</p>
                          <Field label="Opening price" value={`${lpPreview.plan.priceEthPerToken} ETH per ${companion.symbol} (${lpPreview.plan.tokensPerEth} ${companion.symbol} per ETH)`} mono={false} />
                          <Field label="Fully diluted valuation" value={`${lpPreview.plan.fdvEth} ETH at the opening price`} mono={false} />
                          <Field label="Pair" value={`${lpPreview.plan.token0} / ${lpPreview.plan.token1}`} />
                          <Field label="Fee tier / range" value={`${lpPreview.feeTier / 10_000}% · full range (${lpPreview.plan.tickLower} to ${lpPreview.plan.tickUpper})`} mono={false} />
                          <Field label="sqrtPriceX96" value={lpPreview.plan.sqrtPriceX96} />
                          <Field label="Minimum amounts" value={`${lpPreview.plan.amount0Min} / ${lpPreview.plan.amount1Min} base units (${lpPreview.plan.slippageBps / 100}% slippage)`} />
                          <Field label="Balances" value={`${lpPreview.balances.eth} ETH · ${lpPreview.balances.weth} WETH · ${fromTokenUnits(lpPreview.balances.tokenWei)} ${companion.symbol}`} mono={false} />
                          <Field label="Steps" value={<ul className="list-disc pl-4">{lpPreview.steps.map((s) => <li key={s.step} className={s.needed ? "" : "text-muted-foreground line-through"}>{s.label}{s.gasEstimate ? ` (~${s.gasEstimate} gas)` : ""}</li>)}</ul>} mono={false} />
                          <Field label="Estimated fees" value={`~${lpPreview.feeEstimateEth} ETH in gas`} mono={false} />
                          <Field label="Uniswap factory" value={lpPreview.factory} />
                          <Field label="Position manager" value={lpPreview.positionManager} />
                          <Field label="WETH" value={lpPreview.weth} />
                          <Problems items={lpPreview.problems} />
                        </div>
                      ) : null}

                      <fieldset className="space-y-2 rounded-lg border border-border p-3">
                        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Risks I accept</legend>
                        {LIQUIDITY_RISK_STATEMENTS.map((text, i) => (
                          <label key={text} className="flex items-start gap-3">
                            <Checkbox checked={lpRisks[i]} onCheckedChange={(value) => setLpRisks((r) => r.map((v, j) => (j === i ? value === true : v)))} aria-label={text} />
                            <span className="text-sm">{text}</span>
                          </label>
                        ))}
                      </fieldset>

                      <div className="flex flex-wrap gap-3">
                        {!lpPreview ? (
                          <Button onClick={onPreviewLiquidity} disabled={busy !== null || !canSign || !lpTokenAmount || !lpEthAmount}>
                            <Spinner active={busy === "lp-preview"} />
                            Preview opening terms
                          </Button>
                        ) : (
                          <>
                            <Button onClick={onStartLiquidity} disabled={busy !== null || !canSign || !lpRisks.every(Boolean) || lpPreview.problems.length > 0}>
                              <Spinner active={busy === "lp-start"} />
                              <ShieldCheck className="mr-2 h-4 w-4" />
                              Save plan and start signing
                            </Button>
                            <Button variant="ghost" onClick={() => setLpPreview(null)} disabled={busy !== null}>
                              Edit amounts
                            </Button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </Step>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
