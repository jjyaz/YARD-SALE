import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { defaultChain } from "@/lib/chain";
import { companionTokenAbi } from "@/lib/abi";
import { COMPANION_TOKEN_DISCLAIMER } from "@/lib/passport-metadata";

function publicDb() {
  return createClient<Database>(process.env["SUPABASE_URL"]!, process.env["SUPABASE_PUBLISHABLE_KEY"]!, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

async function chainClient() {
  const { createPublicClient, http } = await import("viem");
  return createPublicClient({ chain: defaultChain, transport: http() });
}

function normalizeAddress(value: string): `0x${string}` {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value.trim())) throw new Error("That is not a valid wallet or token address.");
  return value.trim().toLowerCase() as `0x${string}`;
}

function positiveBaseUnits(value: string, label: string): bigint {
  if (!/^\d+$/.test(value.trim())) throw new Error(`${label} must be a whole number.`);
  const parsed = BigInt(value.trim());
  if (parsed <= 0n) throw new Error(`${label} must be greater than zero.`);
  return parsed;
}

export type TokenPageData = Awaited<ReturnType<typeof getTokenPage>>;

/* ------------------------------------------------------------------ read */

export const getTokenPage = createServerFn({ method: "POST" })
  .inputValidator((input: { address: string }) => ({ address: normalizeAddress(input.address) }))
  .handler(async ({ data }) => {
    const db = publicDb();

    const { data: token } = await db
      .from("companion_tokens")
      .select(
        "id, listing_id, passport_id, name, symbol, total_supply, creator_allocation, token_address, tx_hash, chain_id, confirmed_at, wallet_address, status",
      )
      .eq("token_address", data.address)
      .eq("status", "confirmed")
      .maybeSingle();

    if (!token) {
      return {
        found: false as const,
        disclaimer: COMPANION_TOKEN_DISCLAIMER,
        chainId: defaultChain.id,
        chainName: defaultChain.name,
      };
    }

    const [{ data: listing }, { data: offers }, { data: liquidity }] = await Promise.all([
      db.from("listings").select("id, slug, title, status, city, region").eq("id", token.listing_id).maybeSingle(),
      db
        .from("companion_token_offers")
        .select("id, amount_base_units, price_wei_per_token, note, seller_wallet, updated_at")
        .eq("token_id", token.id)
        .eq("status", "active"),
      db
        .from("liquidity_positions")
        .select("pool_address, position_token_id, liquidity, fee_tier, tick_lower, tick_upper, token_amount, eth_amount, mint_tx_hash, chain_id, confirmed_at")
        .eq("token_id", token.id)
        .eq("status", "confirmed")
        .maybeSingle(),
    ]);

    let onchain: {
      ok: boolean;
      error?: string;
      name?: string;
      symbol?: string;
      totalSupply?: string;
      passportTokenId?: string;
      creatorBalance?: string;
      offerSellerBalance?: string;
    } = { ok: false };

    try {
      const client = await chainClient();
      const address = data.address;
      const [name, symbol, totalSupply, passportTokenId, creatorBalance] = await Promise.all([
        client.readContract({ address, abi: companionTokenAbi, functionName: "name" }),
        client.readContract({ address, abi: companionTokenAbi, functionName: "symbol" }),
        client.readContract({ address, abi: companionTokenAbi, functionName: "totalSupply" }),
        client.readContract({ address, abi: companionTokenAbi, functionName: "passportTokenId" }),
        client.readContract({
          address,
          abi: companionTokenAbi,
          functionName: "balanceOf",
          args: [token.wallet_address as `0x${string}`],
        }),
      ]);
      let offerSellerBalance: bigint | undefined;
      const offerWallet = offers?.[0]?.seller_wallet;
      if (offerWallet) {
        offerSellerBalance = await client.readContract({
          address,
          abi: companionTokenAbi,
          functionName: "balanceOf",
          args: [offerWallet as `0x${string}`],
        });
      }
      onchain = {
        ok: true,
        name,
        symbol,
        totalSupply: totalSupply.toString(),
        passportTokenId: passportTokenId.toString(),
        creatorBalance: creatorBalance.toString(),
        ...(offerSellerBalance === undefined ? {} : { offerSellerBalance: offerSellerBalance.toString() }),
      };
    } catch (error) {
      onchain = { ok: false, error: error instanceof Error ? error.message : "Could not reach the network." };
    }

    return {
      found: true as const,
      disclaimer: COMPANION_TOKEN_DISCLAIMER,
      chainId: defaultChain.id,
      chainName: defaultChain.name,
      token,
      listing,
      offers: offers ?? [],
      onchain,
      liquidity: liquidity ?? null,
    };
  });

/* ------------------------------------------------------------ seller offer */

export const upsertTokenOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tokenAddress: string; amountBaseUnits: string; priceWeiPerToken: string; note?: string }) => ({
    tokenAddress: normalizeAddress(input.tokenAddress),
    amountBaseUnits: input.amountBaseUnits,
    priceWeiPerToken: input.priceWeiPerToken,
    note: input.note?.slice(0, 500) ?? null,
  }))
  .handler(async ({ data, context }) => {
    const amount = positiveBaseUnits(data.amountBaseUnits, "The amount of tokens");
    const price = positiveBaseUnits(data.priceWeiPerToken, "The asking price");

    const { data: token, error: tokenError } = await context.supabase
      .from("companion_tokens")
      .select("id, listing_id, user_id, wallet_address, token_address, status")
      .eq("token_address", data.tokenAddress)
      .maybeSingle();
    if (tokenError) throw new Error(tokenError.message);
    if (!token || token.status !== "confirmed") throw new Error("That token has not been verified on-chain yet.");
    if (token.user_id !== context.userId) throw new Error("Only the token creator can offer these tokens for sale.");

    // Verify the seller really holds what they are offering.
    const client = await chainClient();
    const balance = (await client.readContract({
      address: data.tokenAddress,
      abi: companionTokenAbi,
      functionName: "balanceOf",
      args: [token.wallet_address as `0x${string}`],
    })) as bigint;
    if (balance < amount) {
      throw new Error("Your wallet does not hold that many tokens right now. Nothing was saved.");
    }

    await context.supabase
      .from("companion_token_offers")
      .update({ status: "cancelled" })
      .eq("token_id", token.id)
      .eq("status", "active");

    const { data: offer, error } = await context.supabase
      .from("companion_token_offers")
      .insert({
        token_id: token.id,
        listing_id: token.listing_id,
        user_id: context.userId,
        seller_wallet: token.wallet_address,
        amount_base_units: amount.toString(),
        price_wei_per_token: price.toString(),
        note: data.note,
        status: "active",
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return offer;
  });

export const cancelTokenOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { offerId: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("companion_token_offers")
      .update({ status: "cancelled" })
      .eq("id", data.offerId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* --------------------------------------------------------- transfer check */

export const confirmTokenTransfer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tokenAddress: string; txHash: string }) => {
    if (!/^0x[a-fA-F0-9]{64}$/.test(input.txHash)) throw new Error("That is not a valid transaction hash.");
    return { tokenAddress: normalizeAddress(input.tokenAddress), txHash: input.txHash as `0x${string}` };
  })
  .handler(async ({ data }) => {
    const { decodeEventLog, getAddress } = await import("viem");
    const client = await chainClient();
    const receipt = await client.waitForTransactionReceipt({ hash: data.txHash, timeout: 90_000 });
    if (receipt.status !== "success") throw new Error("That transfer reverted on-chain. No tokens moved.");

    for (const log of receipt.logs) {
      if (getAddress(log.address) !== getAddress(data.tokenAddress)) continue;
      try {
        const decoded = decodeEventLog({ abi: companionTokenAbi, data: log.data, topics: log.topics });
        if (decoded.eventName !== "Transfer") continue;
        const args = decoded.args as unknown as { from: string; to: string; value: bigint };
        return {
          confirmed: true as const,
          from: args.from.toLowerCase(),
          to: args.to.toLowerCase(),
          value: args.value.toString(),
          blockNumber: Number(receipt.blockNumber),
        };
      } catch {
        continue;
      }
    }
    throw new Error("No token transfer event was found in that transaction.");
  });
