import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Loader2, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/chain";
import { shortAddress } from "@/lib/listing-meta";
import { companionTokenAbi } from "@/lib/abi";
import { connectAccount, ensureChain, injectedProvider, sendTransaction } from "@/lib/wallet-client";
import {
  cancelTokenOffer,
  confirmTokenTransfer,
  getTokenPage,
  upsertTokenOffer,
} from "@/lib/token-market.functions";

export const Route = createFileRoute("/token/$address")({
  head: ({ params }) => ({
    meta: [
      { title: `Companion token ${params.address.slice(0, 10)}… | YARD SALE` },
      {
        name: "description",
        content:
          "Verified on-chain details for a YARD SALE companion token: supply, paired Item Passport, creator holdings, and the creator's current sale offer.",
      },
      { property: "og:title", content: "YARD SALE companion token" },
      { property: "og:description", content: "Verified supply, paired Item Passport, and the creator's sale offer." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TokenPage,
});

const ONE = 10n ** 18n;

function whole(baseUnits: string | undefined): string {
  if (!baseUnits) return "—";
  try {
    return (BigInt(baseUnits) / ONE).toLocaleString();
  } catch {
    return "—";
  }
}

function eth(wei: string): string {
  try {
    const value = Number(BigInt(wei)) / 1e18;
    return `${value} ETH`;
  } catch {
    return `${wei} wei`;
  }
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-2 last:border-0">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="break-all font-mono text-sm">{value}</span>
    </div>
  );
}

function TokenPage() {
  const { address } = Route.useParams();
  const load = useServerFn(getTokenPage);
  const saveOffer = useServerFn(upsertTokenOffer);
  const cancelOffer = useServerFn(cancelTokenOffer);
  const confirmTransfer = useServerFn(confirmTokenTransfer);

  const [wallet, setWallet] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [recipient, setRecipient] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const page = useQuery({
    queryKey: ["token-page", address.toLowerCase()],
    queryFn: () => load({ data: { address } }),
  });

  useEffect(() => {
    const provider = injectedProvider();
    if (!provider) return;
    void provider
      .request({ method: "eth_accounts" })
      .then((accounts) => setWallet(((accounts as string[])[0] ?? null)?.toLowerCase() ?? null))
      .catch(() => setWallet(null));
  }, []);

  const offerMutation = useMutation({ mutationFn: saveOffer });

  if (page.isLoading) {
    return (
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Loading token…
      </div>
    );
  }

  const data = page.data;
  if (!data || !data.found) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20">
        <h1 className="text-3xl font-extrabold">Token not found</h1>
        <p className="mt-3 text-muted-foreground">
          No verified companion token exists at {shortAddress(address)} on {data?.chainName ?? "this network"}. Tokens
          appear here only after their deployment has been checked on-chain.
        </p>
        <Button asChild className="mt-6">
          <Link to="/browse">Browse listings</Link>
        </Button>
      </div>
    );
  }

  const token = data.token;
  const offer = data.offers[0] ?? null;
  const isCreatorWallet = Boolean(wallet && wallet === token.wallet_address.toLowerCase());

  async function run<T>(key: string, fn: () => Promise<T>) {
    setBusy(key);
    try {
      await fn();
      await page.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  async function onSaveOffer() {
    await run("offer", async () => {
      const amountUnits = (BigInt(amount.trim() || "0") * ONE).toString();
      const priceWei = BigInt(Math.round(Number(price) * 1e18)).toString();
      await offerMutation.mutateAsync({
        data: { tokenAddress: address, amountBaseUnits: amountUnits, priceWeiPerToken: priceWei, note: note.trim() },
      });
      toast.success("Your tokens are listed for sale.");
    });
  }

  async function onCancelOffer() {
    if (!offer) return;
    await run("cancel", async () => {
      await cancelOffer({ data: { offerId: offer.id } });
      toast.success("Offer removed.");
    });
  }

  async function onTransfer() {
    await run("transfer", async () => {
      const account = await connectAccount();
      setWallet(account);
      await ensureChain();
      const { encodeFunctionData } = await import("viem");
      const value = BigInt(sendAmount.trim() || "0") * ONE;
      if (value <= 0n) throw new Error("Enter a whole number of tokens to send.");
      if (!/^0x[a-fA-F0-9]{40}$/.test(recipient.trim())) throw new Error("Enter the buyer's wallet address.");
      const dataHex = encodeFunctionData({
        abi: companionTokenAbi,
        functionName: "transfer",
        args: [recipient.trim() as `0x${string}`, value],
      });
      const hash = await sendTransaction({ from: account, to: address, data: dataHex });
      toast.message("Transfer submitted. Waiting for the receipt…");
      const result = await confirmTransfer({ data: { tokenAddress: address, txHash: hash } });
      toast.success(`Sent ${whole(result.value)} ${token.symbol} to ${shortAddress(result.to)}.`);
    });
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-extrabold">
        {token.name} <span className="text-muted-foreground">({token.symbol})</span>
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Companion token on {data.chainName}. Paired permanently with one Item Passport.
      </p>

      <section className="mt-6 rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-bold">Verified on-chain</h2>
        <div className="mt-3">
          <Row
            label="Token address"
            value={
              <a
                className="inline-flex items-center gap-1 underline"
                href={explorerAddressUrl(token.chain_id, token.token_address ?? address)}
                target="_blank"
                rel="noreferrer"
              >
                {shortAddress(token.token_address ?? address)} <ExternalLink className="h-3 w-3" />
              </a>
            }
          />
          <Row label="Total supply" value={`${whole(data.onchain.totalSupply ?? String(token.total_supply))} ${token.symbol}`} />
          <Row label="Passport token ID" value={data.onchain.passportTokenId ?? "—"} />
          <Row label="Creator wallet" value={shortAddress(token.wallet_address)} />
          <Row
            label="Creator balance"
            value={data.onchain.ok ? `${whole(data.onchain.creatorBalance)} ${token.symbol}` : "Network unavailable"}
          />
          {token.tx_hash ? (
            <Row
              label="Deployment"
              value={
                <a
                  className="inline-flex items-center gap-1 underline"
                  href={explorerTxUrl(token.chain_id, token.tx_hash)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {shortAddress(token.tx_hash)} <ExternalLink className="h-3 w-3" />
                </a>
              }
            />
          ) : null}
          {data.listing ? (
            <Row
              label="Item"
              value={
                data.listing.slug ? (
                  <Link className="underline" to="/item/$slug" params={{ slug: data.listing.slug }}>
                    {data.listing.title}
                  </Link>
                ) : (
                  data.listing.title
                )
              }
            />
          ) : null}
        </div>
        {!data.onchain.ok ? (
          <p className="mt-3 text-sm text-destructive">
            Live chain data is unavailable right now: {data.onchain.error}
          </p>
        ) : null}
      </section>

      <section className="mt-6 rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-bold">For sale</h2>
        {offer ? (
          <div className="mt-3 space-y-2 text-sm">
            <Row label="Amount offered" value={`${whole(offer.amount_base_units)} ${token.symbol}`} />
            <Row label="Asking price" value={`${eth(offer.price_wei_per_token)} per token`} />
            <Row label="Seller wallet" value={shortAddress(offer.seller_wallet)} />
            {data.onchain.offerSellerBalance ? (
              <Row
                label="Seller holds now"
                value={`${whole(data.onchain.offerSellerBalance)} ${token.symbol}`}
              />
            ) : null}
            {offer.note ? <p className="pt-2 text-muted-foreground">{offer.note}</p> : null}
            <p className="pt-2 text-xs text-muted-foreground">
              There is no escrow for token sales yet. Settlement is a direct wallet-to-wallet transfer agreed between
              buyer and seller. Only the transfer itself is verified on-chain.
            </p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">The creator has not offered any tokens for sale.</p>
        )}
      </section>

      {isCreatorWallet ? (
        <>
          <section className="mt-6 rounded-xl border border-border bg-card p-5">
            <h2 className="text-base font-bold">Sell your tokens</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Publish an asking price so buyers can find you, then deliver tokens with a real on-chain transfer once
              you have agreed terms.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="amount">Tokens for sale</Label>
                <Input id="amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100000" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="price">Price per token (ETH)</Label>
                <Input id="price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.0001" />
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <Label htmlFor="note">Note for buyers (optional)</Label>
              <Textarea id="note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button onClick={() => void onSaveOffer()} disabled={busy !== null}>
                {busy === "offer" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {offer ? "Update offer" : "List tokens for sale"}
              </Button>
              {offer ? (
                <Button variant="outline" onClick={() => void onCancelOffer()} disabled={busy !== null}>
                  Remove offer
                </Button>
              ) : null}
            </div>
          </section>

          <section className="mt-6 rounded-xl border border-border bg-card p-5">
            <h2 className="text-base font-bold">Deliver tokens to a buyer</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="recipient">Buyer wallet address</Label>
                <Input id="recipient" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="0x…" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="send">Tokens to send</Label>
                <Input id="send" inputMode="numeric" value={sendAmount} onChange={(e) => setSendAmount(e.target.value)} placeholder="1000" />
              </div>
            </div>
            <Button className="mt-4" onClick={() => void onTransfer()} disabled={busy !== null}>
              {busy === "transfer" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Send tokens
            </Button>
          </section>
        </>
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">
          Connect the creator wallet {shortAddress(token.wallet_address)} to manage this token's sale.
        </p>
      )}

      {data.liquidity ? (
        <section className="mt-6 rounded-xl border border-border bg-card p-5 text-sm">
          <h2 className="text-base font-bold">Uniswap v3 liquidity (verified)</h2>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Pool</dt>
              <dd className="break-all font-mono text-xs">{data.liquidity.pool_address}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Fee tier / range</dt>
              <dd>
                {data.liquidity.fee_tier / 10_000}% · full range ({data.liquidity.tick_lower} to {data.liquidity.tick_upper})
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Seeded with</dt>
              <dd>
                {whole(data.liquidity.token_amount)} {data.token.symbol} + {eth(data.liquidity.eth_amount)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Position NFT</dt>
              <dd>#{data.liquidity.position_token_id} — held by the creator, not locked</dd>
            </div>
          </dl>
          <div className="mt-3 flex flex-wrap gap-4">
            {data.liquidity.pool_address ? (
              <a
                className="inline-flex items-center gap-1 font-semibold underline underline-offset-4"
                href={explorerAddressUrl(data.liquidity.chain_id, data.liquidity.pool_address)}
                target="_blank"
                rel="noreferrer"
              >
                Pool on the explorer <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : null}
            {data.liquidity.mint_tx_hash ? (
              <a
                className="inline-flex items-center gap-1 font-semibold underline underline-offset-4"
                href={explorerTxUrl(data.liquidity.chain_id, data.liquidity.mint_tx_hash)}
                target="_blank"
                rel="noreferrer"
              >
                Position mint transaction <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : null}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            The opening ratio was chosen by the creator. The pool price is not an appraisal of the physical item, liquidity can be removed at
            any time, and the token can go to zero.
          </p>
        </section>
      ) : (
        <section className="mt-6 rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
          <p className="flex items-center gap-2 font-medium text-foreground">
            <Lock className="h-4 w-4" aria-hidden="true" /> Uniswap liquidity
          </p>
          <p className="mt-2">
            No verified liquidity pool for this token. The creator can seed one from the Launchpad on Robinhood Chain mainnet once the
            deployment checks pass; until then this stays locked: available after testnet validation and mainnet contract review.
          </p>
        </section>
      )}

      <p className="mt-6 rounded-xl border border-border bg-secondary p-4 text-xs text-muted-foreground">
        {data.disclaimer}
      </p>
    </div>
  );
}
