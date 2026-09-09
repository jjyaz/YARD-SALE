import { createServerFn } from "@tanstack/react-start";
import type { Log, decodeEventLog as DecodeEventLog, getAddress as GetAddress } from "viem";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { isHexAddress } from "@/config/env";
import { companionTokenAbi } from "@/lib/abi";
import {
  liquidityLockerAbi,
  nonfungiblePositionManagerAbi,
  uniswapV3FactoryAbi,
  uniswapV3PoolAbi,
  weth9Abi,
} from "@/lib/uniswap-abi";
import {
  buildLiquidityPlan,
  parseFixed,
  priceDeviationBps,
  priceFromSqrtPriceX96,
  quoteExistingPool,
  requireFreshQuote,
  type ExistingPoolQuote,
} from "@/lib/uniswap-math";

type LiquidityUpdate = Database["public"]["Tables"]["liquidity_positions"]["Update"];
type IncreaseLiquidityArgs = {
  tokenId: bigint;
  liquidity: bigint;
  amount0: bigint;
  amount1: bigint;
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** The position NFT this receipt minted (Transfer from 0x0) to the expected recipient. */
function findMintedTokenId(
  logs: readonly Log[],
  positionManager: `0x${string}`,
  recipient: `0x${string}`,
  decode: typeof DecodeEventLog,
  checksum: typeof GetAddress,
): bigint | null {
  for (const log of logs) {
    if (checksum(log.address) !== positionManager) continue;
    try {
      const decoded = decode({
        abi: nonfungiblePositionManagerAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName !== "Transfer") continue;
      const args = decoded.args as unknown as { from: string; to: string; tokenId: bigint };
      if (checksum(args.from) !== checksum(ZERO_ADDRESS)) continue;
      if (checksum(args.to) !== recipient) continue;
      return args.tokenId;
    } catch {
      continue;
    }
  }
  return null;
}

function findIncreaseLiquidity(
  logs: readonly Log[],
  positionManager: `0x${string}`,
  decode: typeof DecodeEventLog,
  checksum: typeof GetAddress,
  tokenId?: bigint,
): IncreaseLiquidityArgs | null {
  for (const log of logs) {
    if (checksum(log.address) !== positionManager) continue;
    try {
      const decoded = decode({
        abi: nonfungiblePositionManagerAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName !== "IncreaseLiquidity") continue;
      const args = decoded.args as unknown as IncreaseLiquidityArgs;
      if (tokenId !== undefined && args.tokenId !== tokenId) continue;
      return args;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Optional Uniswap v3 liquidity step for a verified Companion Token (mainnet only).
 * Every transaction is signed by the seller's wallet; the server only prepares calldata,
 * verifies receipts against live chain state, and records what was proven.
 */

export type LiquidityStep =
  "wrap" | "approve_weth" | "approve_token" | "create_pool" | "mint" | "done";
const STEP_ORDER: LiquidityStep[] = [
  "wrap",
  "approve_weth",
  "approve_token",
  "create_pool",
  "mint",
  "done",
];
const STEP_TX_COLUMN: Record<
  Exclude<LiquidityStep, "done">,
  | "wrap_tx_hash"
  | "weth_approve_tx_hash"
  | "token_approve_tx_hash"
  | "pool_tx_hash"
  | "mint_tx_hash"
> = {
  wrap: "wrap_tx_hash",
  approve_weth: "weth_approve_tx_hash",
  approve_token: "token_approve_tx_hash",
  create_pool: "pool_tx_hash",
  mint: "mint_tx_hash",
};

/** Typical gas for the steps that cannot be estimated until earlier steps land. */
const FALLBACK_GAS = { create_pool: 4_800_000n, mint: 550_000n } as const;

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function isTxHash(value: string): value is `0x${string}` {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * Reads the live pool for a pair, if one exists. An initialised pool means the seller's chosen
 * ratio does NOT set the price, so any quote derived from it is stale until re-confirmed.
 */
export async function livePoolState(
  client: Awaited<ReturnType<(typeof import("@/lib/launchpad.server"))["rpcClient"]>>,
  factory: string,
  token0: string,
  token1: string,
  feeTier: number,
) {
  const { getAddress } = await import("viem");
  const { uniswapV3FactoryAbi, uniswapV3PoolAbi } = await import("@/lib/uniswap-abi");
  const pool = await client.readContract({
    address: getAddress(factory),
    abi: uniswapV3FactoryAbi,
    functionName: "getPool",
    args: [getAddress(token0), getAddress(token1), feeTier],
  });
  if (pool === ZERO)
    return { address: null, initialized: false, sqrtPriceX96: null as bigint | null };
  const slot0 = await client.readContract({
    address: getAddress(pool),
    abi: uniswapV3PoolAbi,
    functionName: "slot0",
  });
  return {
    address: getAddress(pool),
    initialized: slot0[0] !== 0n,
    sqrtPriceX96: slot0[0] === 0n ? null : slot0[0],
  };
}

async function loadVerifiedToken(
  db: Awaited<ReturnType<typeof admin>>,
  userId: string,
  listingId: string,
) {
  const { data: token } = await db
    .from("companion_tokens")
    .select("*")
    .eq("listing_id", listingId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!token || token.status !== "confirmed" || !token.token_address) {
    throw new Error("Only a verified Companion Token can be paired with liquidity.");
  }
  return token;
}

async function requireInfra() {
  const { verifyLiquidityInfra, requireVerifiedDeployment, rpcClient } =
    await import("@/lib/launchpad.server");
  const deployment = await requireVerifiedDeployment();
  const infra = await verifyLiquidityInfra();
  if (!infra.available) {
    const blocker = infra.checks.find((c) => !c.ok);
    throw new Error(
      blocker ? `${blocker.label}: ${blocker.detail}` : "Uniswap infrastructure is not available.",
    );
  }
  return { deployment, infra, client: rpcClient(infra.chainId) };
}

/* ------------------------------------------------------------------ preview */

export const previewLiquidity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      listingId: string;
      wallet: string;
      tokenAmount: string;
      ethAmount: string;
      slippageBps: number;
    }) => {
      if (!isHexAddress(input.wallet)) throw new Error("Wallet is not a valid address.");
      if (
        !Number.isInteger(input.slippageBps) ||
        input.slippageBps < 10 ||
        input.slippageBps > 2000
      ) {
        throw new Error("Slippage must be between 0.1% and 20%.");
      }
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { getAddress, formatEther } = await import("viem");
    const db = await admin();
    const token = await loadVerifiedToken(db, context.userId, data.listingId);
    const { infra, client } = await requireInfra();

    const wallet = getAddress(data.wallet);
    const tokenAddress = getAddress(token.token_address!);
    const tokenAmount = parseFixed(data.tokenAmount, 18);
    const ethAmount = parseFixed(data.ethAmount, 18);
    const plan = buildLiquidityPlan({
      tokenAddress,
      wethAddress: infra.weth,
      tokenAmount,
      ethAmount,
      totalSupply: BigInt(String(token.total_supply)),
      slippageBps: data.slippageBps,
      tickSpacing: infra.tickSpacing,
    });

    const pm = infra.positionManager as `0x${string}`;
    const weth = infra.weth as `0x${string}`;
    const [
      ethBalance,
      tokenBalance,
      wethBalance,
      wethAllowance,
      tokenAllowance,
      poolAddress,
      gasPrice,
    ] = await Promise.all([
      client.getBalance({ address: wallet }),
      client.readContract({
        address: tokenAddress,
        abi: companionTokenAbi,
        functionName: "balanceOf",
        args: [wallet],
      }),
      client.readContract({
        address: weth,
        abi: weth9Abi,
        functionName: "balanceOf",
        args: [wallet],
      }),
      client.readContract({
        address: weth,
        abi: weth9Abi,
        functionName: "allowance",
        args: [wallet, pm],
      }),
      client.readContract({
        address: tokenAddress,
        abi: companionTokenAbi,
        functionName: "allowance",
        args: [wallet, pm],
      }),
      client.readContract({
        address: infra.factory as `0x${string}`,
        abi: uniswapV3FactoryAbi,
        functionName: "getPool",
        args: [plan.token0, plan.token1, infra.feeTier],
      }),
      client.getGasPrice(),
    ]);

    /** What the live price actually consumes, and what comes back. */
    type LiveQuote = {
      liquidity: string;
      amount0Used: string;
      amount1Used: string;
      amount0Excess: string;
      amount1Excess: string;
      amount0Min: string;
      amount1Min: string;
      tokenUsed: string;
      ethUsed: string;
      tokenExcess: string;
      ethExcess: string;
      /** How far the live price has moved from the seller's own opening ratio. */
      movementBpsFromRequested: number;
    };
    let existingPool: {
      address: string;
      initialized: boolean;
      priceToken1PerToken0: string | null;
      sqrtPriceX96: string | null;
      liquidity: string;
      quote: LiveQuote | null;
    } | null = null;
    if (poolAddress !== ZERO) {
      const [slot0, liquidity] = await Promise.all([
        client.readContract({ address: poolAddress, abi: uniswapV3PoolAbi, functionName: "slot0" }),
        client.readContract({
          address: poolAddress,
          abi: uniswapV3PoolAbi,
          functionName: "liquidity",
        }),
      ]);
      let quote: LiveQuote | null = null;
      if (slot0[0] !== 0n) {
        const q = quoteExistingPool({
          sqrtPriceX96: slot0[0],
          tickLower: plan.tickLower,
          tickUpper: plan.tickUpper,
          amount0Max: plan.amount0Desired,
          amount1Max: plan.amount1Desired,
          slippageBps: data.slippageBps,
        });
        quote = {
          liquidity: q.liquidity.toString(),
          amount0Used: q.amount0Used.toString(),
          amount1Used: q.amount1Used.toString(),
          amount0Excess: q.amount0Excess.toString(),
          amount1Excess: q.amount1Excess.toString(),
          amount0Min: q.amount0Min.toString(),
          amount1Min: q.amount1Min.toString(),
          tokenUsed: formatEther(plan.tokenIsToken0 ? q.amount0Used : q.amount1Used),
          ethUsed: formatEther(plan.tokenIsToken0 ? q.amount1Used : q.amount0Used),
          tokenExcess: formatEther(plan.tokenIsToken0 ? q.amount0Excess : q.amount1Excess),
          ethExcess: formatEther(plan.tokenIsToken0 ? q.amount1Excess : q.amount0Excess),
          movementBpsFromRequested: priceDeviationBps(plan.sqrtPriceX96, slot0[0]),
        };
      }
      existingPool = {
        address: poolAddress,
        initialized: slot0[0] !== 0n,
        priceToken1PerToken0: slot0[0] !== 0n ? priceFromSqrtPriceX96(slot0[0]) : null,
        sqrtPriceX96: slot0[0] !== 0n ? slot0[0].toString() : null,
        liquidity: liquidity.toString(),
        quote,
      };
    }

    const wrapNeeded = ethAmount > wethBalance ? ethAmount - wethBalance : 0n;
    const steps: {
      step: LiquidityStep;
      label: string;
      needed: boolean;
      gasEstimate: bigint | null;
    }[] = [];
    const estimate = async (fn: () => Promise<bigint>) => {
      try {
        return await fn();
      } catch {
        return null;
      }
    };
    steps.push({
      step: "wrap",
      label:
        wrapNeeded > 0n
          ? `Wrap ${formatEther(wrapNeeded)} ETH into WETH`
          : "Wrap ETH (already have enough WETH)",
      needed: wrapNeeded > 0n,
      gasEstimate:
        wrapNeeded > 0n && ethBalance >= wrapNeeded
          ? await estimate(() =>
              client.estimateContractGas({
                address: weth,
                abi: weth9Abi,
                functionName: "deposit",
                account: wallet,
                value: wrapNeeded,
              }),
            )
          : null,
    });
    steps.push({
      step: "approve_weth",
      label: `Approve exactly ${formatEther(ethAmount)} WETH for the position manager`,
      needed: wethAllowance < ethAmount,
      gasEstimate:
        wethAllowance < ethAmount
          ? await estimate(() =>
              client.estimateContractGas({
                address: weth,
                abi: weth9Abi,
                functionName: "approve",
                args: [pm, ethAmount],
                account: wallet,
              }),
            )
          : null,
    });
    steps.push({
      step: "approve_token",
      label: `Approve exactly ${data.tokenAmount} ${token.symbol} for the position manager`,
      needed: tokenAllowance < tokenAmount,
      gasEstimate:
        tokenAllowance < tokenAmount
          ? await estimate(() =>
              client.estimateContractGas({
                address: tokenAddress,
                abi: companionTokenAbi,
                functionName: "approve",
                args: [pm, tokenAmount],
                account: wallet,
              }),
            )
          : null,
    });
    steps.push({
      step: "create_pool",
      label: existingPool?.initialized
        ? "Pool already exists and is initialised (your ratio will NOT set the price)"
        : "Create and initialise the 0.3% pool at your opening price",
      needed: !existingPool?.initialized,
      gasEstimate: existingPool?.initialized ? null : FALLBACK_GAS.create_pool,
    });
    steps.push({
      step: "mint",
      label: "Mint the full-range liquidity position",
      needed: true,
      gasEstimate: FALLBACK_GAS.mint,
    });

    const totalGas = steps.reduce(
      (sum, s) => sum + (s.needed && s.gasEstimate ? s.gasEstimate : 0n),
      0n,
    );
    const feeEstimateWei = totalGas * gasPrice;
    const ethNeeded = wrapNeeded + feeEstimateWei;

    return {
      chainId: infra.chainId,
      token: {
        address: tokenAddress,
        symbol: token.symbol,
        name: token.name,
        totalSupply: String(token.total_supply),
      },
      weth: infra.weth,
      positionManager: infra.positionManager,
      factory: infra.factory,
      feeTier: infra.feeTier,
      tickSpacing: infra.tickSpacing,
      plan: {
        token0: plan.token0,
        token1: plan.token1,
        tokenIsToken0: plan.tokenIsToken0,
        amount0Desired: plan.amount0Desired.toString(),
        amount1Desired: plan.amount1Desired.toString(),
        amount0Min: plan.amount0Min.toString(),
        amount1Min: plan.amount1Min.toString(),
        sqrtPriceX96: plan.sqrtPriceX96.toString(),
        tickLower: plan.tickLower,
        tickUpper: plan.tickUpper,
        priceEthPerToken: plan.priceEthPerToken,
        tokensPerEth: plan.tokensPerEth,
        fdvEth: plan.fdvEth,
        slippageBps: data.slippageBps,
      },
      balances: {
        ethWei: ethBalance.toString(),
        eth: formatEther(ethBalance),
        wethWei: wethBalance.toString(),
        weth: formatEther(wethBalance),
        tokenWei: tokenBalance.toString(),
        wethAllowanceWei: wethAllowance.toString(),
        tokenAllowanceWei: tokenAllowance.toString(),
      },
      steps: steps.map((s) => ({ ...s, gasEstimate: s.gasEstimate?.toString() ?? null })),
      gasPriceWei: gasPrice.toString(),
      feeEstimateEth: formatEther(feeEstimateWei),
      existingPool,
      problems: [
        tokenBalance < tokenAmount
          ? `Your wallet holds ${formatEther(tokenBalance)} ${token.symbol}, less than the ${data.tokenAmount} you want to deposit.`
          : null,
        ethBalance < ethNeeded
          ? `Your wallet holds ${formatEther(ethBalance)} ETH; about ${formatEther(ethNeeded)} ETH is needed for the deposit plus gas.`
          : null,
        existingPool?.initialized && existingPool.quote
          ? `A pool for this pair already exists and trades at ${existingPool.priceToken1PerToken0} ${plan.tokenIsToken0 ? "WETH per token" : "tokens per WETH"} — ` +
            `${(existingPool.quote.movementBpsFromRequested / 100).toFixed(2)}% away from your opening ratio. At that price the deposit uses ` +
            `${existingPool.quote.tokenUsed} ${token.symbol} and ${existingPool.quote.ethUsed} ETH; ` +
            `${existingPool.quote.tokenExcess} ${token.symbol} and ${existingPool.quote.ethExcess} ETH stay in your wallet. ` +
            `The minimums are recalculated from this live price and you must confirm it before any approval.`
          : null,
      ].filter((p): p is string => Boolean(p)),
    };
  });

/* --------------------------------------------------------------- start plan */

export const startLiquidity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      listingId: string;
      wallet: string;
      tokenAmount: string;
      ethAmount: string;
      slippageBps: number;
      risksAccepted: boolean;
      /** Live pool sqrtPriceX96 the seller explicitly re-confirmed, when a pool already exists. */
      acknowledgedPoolPriceX96?: string | null;
    }) => {
      if (!isHexAddress(input.wallet)) throw new Error("Wallet is not a valid address.");
      if (!input.risksAccepted) throw new Error("You must accept every liquidity risk statement.");
      if (
        !Number.isInteger(input.slippageBps) ||
        input.slippageBps < 10 ||
        input.slippageBps > 2000
      )
        throw new Error("Slippage must be between 0.1% and 20%.");
      if (input.acknowledgedPoolPriceX96 != null && !/^\d+$/.test(input.acknowledgedPoolPriceX96)) {
        throw new Error("The acknowledged pool price is not a valid value.");
      }
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { getAddress } = await import("viem");
    const db = await admin();
    const token = await loadVerifiedToken(db, context.userId, data.listingId);
    const { infra } = await requireInfra();
    const { data: wallets } = await db
      .from("wallets")
      .select("address")
      .eq("user_id", context.userId);
    if (!(wallets ?? []).some((w) => w.address.toLowerCase() === data.wallet.toLowerCase())) {
      throw new Error("The connected wallet is not linked to this account.");
    }
    if (getAddress(token.wallet_address) !== getAddress(data.wallet)) {
      throw new Error("Only the wallet that created the token can launch its liquidity from here.");
    }

    const { data: existing } = await db
      .from("liquidity_positions")
      .select("*")
      .eq("token_id", token.id)
      .maybeSingle();
    if (existing?.status === "confirmed")
      throw new Error("Liquidity has already been launched for this token.");
    if (existing && existing.status === "in_progress" && existing.step !== "wrap") {
      throw new Error(
        "A liquidity launch is already in progress. Continue it below or reset it first.",
      );
    }

    const tokenAmount = parseFixed(data.tokenAmount, 18);
    const ethAmount = parseFixed(data.ethAmount, 18);
    const plan = buildLiquidityPlan({
      tokenAddress: token.token_address!,
      wethAddress: infra.weth,
      tokenAmount,
      ethAmount,
      totalSupply: BigInt(String(token.total_supply)),
      slippageBps: data.slippageBps,
      tickSpacing: infra.tickSpacing,
    });

    // A pool that already exists sets the price — the seller's ratio does not. The quote is only
    // valid against the live price they were shown and explicitly re-confirmed.
    const { client } = await requireInfra();
    const live = await livePoolState(
      client,
      infra.factory,
      plan.token0,
      plan.token1,
      infra.feeTier,
    );
    // Defaults for a brand-new pool: the seller's ratio IS the price, so both sides are consumed.
    let amount0Min = plan.amount0Min;
    let amount1Min = plan.amount1Min;
    let quote: ExistingPoolQuote | null = null;

    if (live.initialized && live.sqrtPriceX96) {
      const acknowledged = data.acknowledgedPoolPriceX96
        ? BigInt(data.acknowledgedPoolPriceX96)
        : null;
      if (!acknowledged) {
        throw new Error(
          `A 0.3% pool already exists at ${live.address} and is trading at sqrtPriceX96 ${live.sqrtPriceX96.toString()}. ` +
            `Your opening ratio will NOT set the price. Review the live price and confirm it before continuing.`,
        );
      }
      if (priceDeviationBps(acknowledged, live.sqrtPriceX96) > data.slippageBps) {
        throw new Error(
          `The pool price moved since you were quoted (confirmed ${acknowledged.toString()}, live ${live.sqrtPriceX96.toString()}). ` +
            `The quote is void — review the new price and confirm it again.`,
        );
      }
      // Minimums must come from the LIVE price, never from the seller's opening ratio.
      quote = quoteExistingPool({
        sqrtPriceX96: live.sqrtPriceX96,
        tickLower: plan.tickLower,
        tickUpper: plan.tickUpper,
        amount0Max: plan.amount0Desired,
        amount1Max: plan.amount1Desired,
        slippageBps: data.slippageBps,
      });
      amount0Min = quote.amount0Min;
      amount1Min = quote.amount1Min;
    }

    const row = {
      token_id: token.id,
      listing_id: token.listing_id,
      user_id: context.userId,
      chain_id: infra.chainId,
      wallet_address: data.wallet.toLowerCase(),
      token_address: token.token_address!.toLowerCase(),
      weth_address: infra.weth.toLowerCase(),
      position_manager: infra.positionManager.toLowerCase(),
      factory_address: infra.factory.toLowerCase(),
      fee_tier: infra.feeTier,
      token0: plan.token0,
      token1: plan.token1,
      sqrt_price_x96: plan.sqrtPriceX96.toString(),
      tick_lower: plan.tickLower,
      tick_upper: plan.tickUpper,
      token_amount: tokenAmount.toString(),
      eth_amount: ethAmount.toString(),
      amount0_min: amount0Min.toString(),
      amount1_min: amount1Min.toString(),
      quote_liquidity: quote ? quote.liquidity.toString() : null,
      quote_amount0_used: quote ? quote.amount0Used.toString() : plan.amount0Desired.toString(),
      quote_amount1_used: quote ? quote.amount1Used.toString() : plan.amount1Desired.toString(),
      quote_amount0_excess: quote ? quote.amount0Excess.toString() : "0",
      quote_amount1_excess: quote ? quote.amount1Excess.toString() : "0",
      slippage_bps: data.slippageBps,
      acknowledged_pool_price_x96:
        live.initialized && live.sqrtPriceX96 ? live.sqrtPriceX96.toString() : null,
      acknowledged_pool_price_at: live.initialized ? new Date().toISOString() : null,
      step: "wrap" as const,
      status: "in_progress" as const,
      failure_reason: null,
      risk_accepted_at: new Date().toISOString(),
      wrap_tx_hash: null,
      weth_approve_tx_hash: null,
      token_approve_tx_hash: null,
      pool_tx_hash: null,
      mint_tx_hash: null,
      pool_address: null,
      position_token_id: null,
      liquidity: null,
      confirmed_at: null,
    };
    const { data: saved, error } = existing
      ? await db.from("liquidity_positions").update(row).eq("id", existing.id).select("*").single()
      : await db.from("liquidity_positions").insert(row).select("*").single();
    if (error) throw new Error(error.message);
    return saved;
  });

/* ------------------------------------------------------------- prepare step */

export const prepareLiquidityStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { listingId: string }) => input)
  .handler(async ({ data, context }) => {
    const { encodeFunctionData, getAddress, formatEther } = await import("viem");
    const db = await admin();
    const { infra, client } = await requireInfra();
    const { data: position } = await db
      .from("liquidity_positions")
      .select("*")
      .eq("listing_id", data.listingId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!position) throw new Error("Start the liquidity plan first.");
    if (position.status === "confirmed") throw new Error("Liquidity is already live.");

    const wallet = getAddress(position.wallet_address);
    const pm = getAddress(position.position_manager);
    const weth = getAddress(position.weth_address);
    const tokenAddress = getAddress(position.token_address);
    const tokenAmount = BigInt(position.token_amount);
    const ethAmount = BigInt(position.eth_amount);
    const token0 = getAddress(position.token0);
    const token1 = getAddress(position.token1);

    // Never prepare a new transaction while one for the current step is still unverified.
    const step = position.step as LiquidityStep;
    if (step === "done") throw new Error("All steps are complete. Verify the position.");
    const pendingHash = position[STEP_TX_COLUMN[step]];
    if (pendingHash) {
      return {
        step,
        skip: false as const,
        pendingTxHash: pendingHash,
        to: null,
        data: null,
        value: null,
        description: "A transaction for this step is pending verification.",
      };
    }

    const [wethBalance, wethAllowance, tokenAllowance, poolAddress] = await Promise.all([
      client.readContract({
        address: weth,
        abi: weth9Abi,
        functionName: "balanceOf",
        args: [wallet],
      }),
      client.readContract({
        address: weth,
        abi: weth9Abi,
        functionName: "allowance",
        args: [wallet, pm],
      }),
      client.readContract({
        address: tokenAddress,
        abi: companionTokenAbi,
        functionName: "allowance",
        args: [wallet, pm],
      }),
      client.readContract({
        address: getAddress(position.factory_address),
        abi: uniswapV3FactoryAbi,
        functionName: "getPool",
        args: [token0, token1, position.fee_tier],
      }),
    ]);

    const advance = async (next: LiquidityStep) => {
      await db
        .from("liquidity_positions")
        .update({ step: next, status: "in_progress" })
        .eq("id", position.id);
    };

    if (step === "wrap") {
      const shortfall = ethAmount > wethBalance ? ethAmount - wethBalance : 0n;
      if (shortfall === 0n) {
        await advance("approve_weth");
        return {
          step,
          skip: true as const,
          description: "You already hold enough WETH; nothing to wrap.",
        };
      }
      return {
        step,
        skip: false as const,
        pendingTxHash: null,
        to: weth,
        data: encodeFunctionData({ abi: weth9Abi, functionName: "deposit" }),
        value: `0x${shortfall.toString(16)}`,
        description: `Wrap exactly ${formatEther(shortfall)} ETH into WETH (the shortfall only).`,
      };
    }
    if (step === "approve_weth") {
      if (wethAllowance >= ethAmount) {
        await advance("approve_token");
        return { step, skip: true as const, description: "WETH allowance is already sufficient." };
      }
      return {
        step,
        skip: false as const,
        pendingTxHash: null,
        to: weth,
        data: encodeFunctionData({ abi: weth9Abi, functionName: "approve", args: [pm, ethAmount] }),
        value: null,
        description: `Approve exactly ${formatEther(ethAmount)} WETH — not unlimited.`,
      };
    }
    if (step === "approve_token") {
      if (tokenAllowance >= tokenAmount) {
        await advance("create_pool");
        return { step, skip: true as const, description: "Token allowance is already sufficient." };
      }
      return {
        step,
        skip: false as const,
        pendingTxHash: null,
        to: tokenAddress,
        data: encodeFunctionData({
          abi: companionTokenAbi,
          functionName: "approve",
          args: [pm, tokenAmount],
        }),
        value: null,
        description: `Approve exactly ${formatEther(tokenAmount)} tokens — not unlimited.`,
      };
    }
    if (step === "create_pool") {
      if (poolAddress !== ZERO) {
        const slot0 = await client.readContract({
          address: poolAddress,
          abi: uniswapV3PoolAbi,
          functionName: "slot0",
        });
        if (slot0[0] !== 0n) {
          requireFreshQuote(position, slot0[0]);
          await db
            .from("liquidity_positions")
            .update({
              step: "mint",
              status: "in_progress",
              pool_address: poolAddress.toLowerCase(),
            })
            .eq("id", position.id);
          return {
            step,
            skip: true as const,
            description: `The pool already exists at ${poolAddress} and is initialised.`,
          };
        }
      }
      return {
        step,
        skip: false as const,
        pendingTxHash: null,
        to: pm,
        data: encodeFunctionData({
          abi: nonfungiblePositionManagerAbi,
          functionName: "createAndInitializePoolIfNecessary",
          args: [token0, token1, position.fee_tier, BigInt(position.sqrt_price_x96)],
        }),
        value: null,
        description: "Create the 0.3% pool and set its opening price from your ratio.",
      };
    }
    // mint
    if (poolAddress !== ZERO) {
      const slot0 = await client.readContract({
        address: poolAddress,
        abi: uniswapV3PoolAbi,
        functionName: "slot0",
      });
      if (slot0[0] !== 0n) requireFreshQuote(position, slot0[0]);
    }
    if (wethBalance < ethAmount)
      throw new Error(
        `Your WETH balance (${formatEther(wethBalance)}) dropped below the planned ${formatEther(ethAmount)}. Reset the plan.`,
      );
    if (wethAllowance < ethAmount || tokenAllowance < tokenAmount)
      throw new Error(
        "An approval is missing or was reduced. Reset the plan and run the approvals again.",
      );
    const deadline = BigInt(Math.floor(Date.now() / 1000) + position.deadline_seconds);
    const params = {
      token0,
      token1,
      fee: position.fee_tier,
      tickLower: position.tick_lower,
      tickUpper: position.tick_upper,
      amount0Desired: token0 === tokenAddress ? tokenAmount : ethAmount,
      amount1Desired: token1 === tokenAddress ? tokenAmount : ethAmount,
      amount0Min: BigInt(position.amount0_min),
      amount1Min: BigInt(position.amount1_min),
      recipient: wallet,
      deadline,
    } as const;
    return {
      step,
      skip: false as const,
      pendingTxHash: null,
      to: pm,
      data: encodeFunctionData({
        abi: nonfungiblePositionManagerAbi,
        functionName: "mint",
        args: [params],
      }),
      value: null,
      description: `Mint the full-range position (ticks ${position.tick_lower} to ${position.tick_upper}); the deadline is ${position.deadline_seconds / 60} minutes from now.`,
      params: {
        ...params,
        amount0Desired: params.amount0Desired.toString(),
        amount1Desired: params.amount1Desired.toString(),
        amount0Min: params.amount0Min.toString(),
        amount1Min: params.amount1Min.toString(),
        deadline: deadline.toString(),
      },
    };
  });

/* -------------------------------------------------------------- record step */

export const recordLiquidityStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { listingId: string; step: LiquidityStep; txHash: string }) => {
    if (!isTxHash(input.txHash)) throw new Error("Invalid transaction hash.");
    if (input.step === "done") throw new Error("Nothing to record for the final step.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { data: position } = await db
      .from("liquidity_positions")
      .select("*")
      .eq("listing_id", data.listingId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!position) throw new Error("Start the liquidity plan first.");
    if (position.step !== data.step)
      throw new Error(`The plan is at step "${position.step}", not "${data.step}".`);
    const column = STEP_TX_COLUMN[data.step as Exclude<LiquidityStep, "done">];
    if (position[column] && position[column] !== data.txHash)
      throw new Error("A different transaction is already recorded for this step.");
    const update: LiquidityUpdate = { status: "in_progress", failure_reason: null };
    update[column] = data.txHash;
    const { data: saved, error } = await db
      .from("liquidity_positions")
      .update(update)
      .eq("id", position.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return saved;
  });

/* ---------------------------------------------------------------- reconcile */

export const reconcileLiquidity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { listingId: string }) => input)
  .handler(async ({ data, context }) => {
    const { decodeEventLog, getAddress } = await import("viem");
    const db = await admin();
    const { infra, client } = await requireInfra();
    const { data: position } = await db
      .from("liquidity_positions")
      .select("*")
      .eq("listing_id", data.listingId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!position) throw new Error("Start the liquidity plan first.");
    if (position.status === "confirmed")
      return { outcome: "confirmed" as const, position, message: "Already verified." };

    const step = position.step as LiquidityStep;
    if (step === "done") throw new Error("Unexpected state: no step to verify.");
    const column = STEP_TX_COLUMN[step];
    const hash = position[column];
    if (!hash || !isTxHash(hash))
      return {
        outcome: "pending" as const,
        position,
        message: "No transaction recorded for the current step.",
      };

    let receipt;
    try {
      receipt = await client.waitForTransactionReceipt({
        hash,
        timeout: 60_000,
        pollingInterval: 2_000,
      });
    } catch {
      return {
        outcome: "pending" as const,
        position,
        message: "The transaction has not been mined yet. Check again shortly.",
      };
    }
    if (receipt.status !== "success") {
      const failedUpdate: LiquidityUpdate = {
        status: "failed",
        failure_reason: `The ${step.replace("_", " ")} transaction reverted on-chain.`,
      };
      failedUpdate[column] = null;
      const { data: failed } = await db
        .from("liquidity_positions")
        .update(failedUpdate)
        .eq("id", position.id)
        .select("*")
        .single();
      return {
        outcome: "failed" as const,
        position: failed,
        message: `The ${step.replace("_", " ")} transaction reverted.`,
      };
    }

    const wallet = getAddress(position.wallet_address);
    const pm = getAddress(position.position_manager);
    const weth = getAddress(position.weth_address);
    const tokenAddress = getAddress(position.token_address);
    const token0 = getAddress(position.token0);
    const token1 = getAddress(position.token1);
    const nextIndex = STEP_ORDER.indexOf(step) + 1;
    const next = STEP_ORDER[nextIndex] as LiquidityStep;

    // ---- Transaction-level verification -------------------------------------------------
    // A mined receipt proves nothing on its own. The transaction itself must be the exact call
    // this plan asked for: right sender, right contract, right ETH value, right decoded
    // arguments. Sufficient balances or allowances are never accepted as evidence.
    const { decodeFunctionData } = await import("viem");
    const tx = await client.getTransaction({ hash });
    if (getAddress(tx.from) !== wallet) {
      throw new Error(
        `That transaction was sent by ${getAddress(tx.from)}, not by the planned wallet ${wallet}. Nothing advanced.`,
      );
    }
    const expectedTarget =
      step === "wrap" || step === "approve_weth"
        ? weth
        : step === "approve_token"
          ? tokenAddress
          : pm;
    if (!tx.to || getAddress(tx.to) !== expectedTarget) {
      throw new Error(
        `That transaction was sent to ${tx.to ?? "a contract deployment"}, not to the expected ${expectedTarget}. Nothing advanced.`,
      );
    }
    if (step !== "wrap" && tx.value !== 0n) {
      throw new Error("That transaction carried ETH, which this step never does. Nothing advanced.");
    }

    if (step === "wrap") {
      const call = decodeFunctionData({ abi: weth9Abi, data: tx.input });
      if (call.functionName !== "deposit")
        throw new Error(`That transaction called ${call.functionName}, not deposit.`);
      if (tx.value <= 0n) throw new Error("The wrap transaction sent no ETH. Nothing advanced.");
    } else if (step === "approve_weth" || step === "approve_token") {
      const abi = step === "approve_weth" ? weth9Abi : companionTokenAbi;
      const call = decodeFunctionData({ abi, data: tx.input });
      if (call.functionName !== "approve")
        throw new Error(`That transaction called ${call.functionName}, not approve.`);
      const [spender, value] = call.args as unknown as [string, bigint];
      if (getAddress(spender) !== pm)
        throw new Error(
          `The approval was granted to ${getAddress(spender)}, not to the official position manager ${pm}. Nothing advanced.`,
        );
      const required =
        step === "approve_weth" ? BigInt(position.eth_amount) : BigInt(position.token_amount);
      if (value < required)
        throw new Error("The approved amount is below the planned deposit. Nothing advanced.");
    } else if (step === "create_pool") {
      const call = decodeFunctionData({ abi: nonfungiblePositionManagerAbi, data: tx.input });
      if (call.functionName !== "createAndInitializePoolIfNecessary")
        throw new Error(
          `That transaction called ${call.functionName}, not createAndInitializePoolIfNecessary.`,
        );
      const [a0, a1, fee, sqrtPrice] = call.args as unknown as [string, string, number, bigint];
      if (
        getAddress(a0) !== token0 ||
        getAddress(a1) !== token1 ||
        Number(fee) !== position.fee_tier ||
        sqrtPrice !== BigInt(position.sqrt_price_x96)
      ) {
        throw new Error(
          "The pool-creation calldata does not match the plan (tokens, fee tier or opening price). Nothing advanced.",
        );
      }
    } else if (step === "mint") {
      const call = decodeFunctionData({ abi: nonfungiblePositionManagerAbi, data: tx.input });
      if (call.functionName !== "mint")
        throw new Error(`That transaction called ${call.functionName}, not mint.`);
      const [params] = call.args as unknown as [
        {
          token0: string;
          token1: string;
          fee: number;
          tickLower: number;
          tickUpper: number;
          amount0Desired: bigint;
          amount1Desired: bigint;
          amount0Min: bigint;
          amount1Min: bigint;
          recipient: string;
        },
      ];
      const plannedDesired0 =
        token0 === tokenAddress ? BigInt(position.token_amount) : BigInt(position.eth_amount);
      const plannedDesired1 =
        token1 === tokenAddress ? BigInt(position.token_amount) : BigInt(position.eth_amount);
      if (
        getAddress(params.token0) !== token0 ||
        getAddress(params.token1) !== token1 ||
        Number(params.fee) !== position.fee_tier ||
        Number(params.tickLower) !== position.tick_lower ||
        Number(params.tickUpper) !== position.tick_upper ||
        params.amount0Desired !== plannedDesired0 ||
        params.amount1Desired !== plannedDesired1 ||
        params.amount0Min !== BigInt(position.amount0_min) ||
        params.amount1Min !== BigInt(position.amount1_min) ||
        getAddress(params.recipient) !== wallet
      ) {
        throw new Error(
          "The mint calldata does not match the confirmed plan (tokens, fee, ticks, amounts, minimums or recipient). Nothing was saved.",
        );
      }
    }

    // Verify the effect of each step against live state, not just the receipt.
    if (step === "wrap") {
      const balance = await client.readContract({
        address: weth,
        abi: weth9Abi,
        functionName: "balanceOf",
        args: [wallet],
      });
      if (balance < BigInt(position.eth_amount))
        throw new Error(
          "The wrap was mined but the WETH balance is still below the planned amount. Nothing advanced.",
        );
    } else if (step === "approve_weth") {
      const allowance = await client.readContract({
        address: weth,
        abi: weth9Abi,
        functionName: "allowance",
        args: [wallet, pm],
      });
      if (allowance < BigInt(position.eth_amount))
        throw new Error(
          "The approval was mined but the WETH allowance is still insufficient. Nothing advanced.",
        );
    } else if (step === "approve_token") {
      const allowance = await client.readContract({
        address: tokenAddress,
        abi: companionTokenAbi,
        functionName: "allowance",
        args: [wallet, pm],
      });
      if (allowance < BigInt(position.token_amount))
        throw new Error(
          "The approval was mined but the token allowance is still insufficient. Nothing advanced.",
        );
    } else if (step === "create_pool") {
      const poolAddress = await client.readContract({
        address: getAddress(position.factory_address),
        abi: uniswapV3FactoryAbi,
        functionName: "getPool",
        args: [token0, token1, position.fee_tier],
      });
      if (poolAddress === ZERO)
        throw new Error(
          "The transaction was mined but the official factory reports no pool for this pair. Nothing advanced.",
        );
      const [slot0, pToken0, pToken1, pFee, pFactory] = await Promise.all([
        client.readContract({ address: poolAddress, abi: uniswapV3PoolAbi, functionName: "slot0" }),
        client.readContract({
          address: poolAddress,
          abi: uniswapV3PoolAbi,
          functionName: "token0",
        }),
        client.readContract({
          address: poolAddress,
          abi: uniswapV3PoolAbi,
          functionName: "token1",
        }),
        client.readContract({ address: poolAddress, abi: uniswapV3PoolAbi, functionName: "fee" }),
        client.readContract({
          address: poolAddress,
          abi: uniswapV3PoolAbi,
          functionName: "factory",
        }),
      ]);
      if (slot0[0] === 0n)
        throw new Error("The pool exists but is not initialised. Nothing advanced.");
      if (
        getAddress(pToken0) !== token0 ||
        getAddress(pToken1) !== token1 ||
        Number(pFee) !== position.fee_tier ||
        getAddress(pFactory) !== getAddress(infra.factory)
      ) {
        throw new Error(
          "The pool's tokens, fee or factory do not match the plan. Nothing advanced.",
        );
      }
      await db
        .from("liquidity_positions")
        .update({ pool_address: poolAddress.toLowerCase() })
        .eq("id", position.id);
    } else if (step === "mint") {
      // Bind to the position NFT this very transaction minted to this wallet. An unrelated
      // IncreaseLiquidity event in the same receipt is never accepted.
      const mintedTokenId = findMintedTokenId(receipt.logs, pm, wallet, decodeEventLog, getAddress);
      if (mintedTokenId === null) {
        throw new Error(
          "The transaction succeeded but the position manager did not mint a position NFT to your wallet in it. Nothing was saved.",
        );
      }
      const minted = findIncreaseLiquidity(receipt.logs, pm, decodeEventLog, getAddress, mintedTokenId);
      if (!minted)
        throw new Error(
          "The transaction succeeded but no IncreaseLiquidity event for the newly minted position was emitted. Nothing was saved.",
        );
      if (minted.amount0 < BigInt(position.amount0_min) || minted.amount1 < BigInt(position.amount1_min)) {
        throw new Error(
          "The amounts actually deposited are below the confirmed minimums. Nothing was saved.",
        );
      }
      const [owner, pos, poolAddress] = await Promise.all([
        client.readContract({
          address: pm,
          abi: nonfungiblePositionManagerAbi,
          functionName: "ownerOf",
          args: [minted.tokenId],
        }),
        client.readContract({
          address: pm,
          abi: nonfungiblePositionManagerAbi,
          functionName: "positions",
          args: [minted.tokenId],
        }),
        client.readContract({
          address: getAddress(position.factory_address),
          abi: uniswapV3FactoryAbi,
          functionName: "getPool",
          args: [token0, token1, position.fee_tier],
        }),
      ]);
      if (getAddress(owner) !== wallet)
        throw new Error("The position NFT is not owned by your wallet. Nothing was saved.");
      if (
        getAddress(pos[2]) !== token0 ||
        getAddress(pos[3]) !== token1 ||
        Number(pos[4]) !== position.fee_tier ||
        pos[5] !== position.tick_lower ||
        pos[6] !== position.tick_upper
      ) {
        throw new Error(
          "The minted position does not match the plan (tokens, fee or ticks). Nothing was saved.",
        );
      }
      if (pos[7] === 0n || minted.liquidity === 0n)
        throw new Error("The position has zero liquidity. Nothing was saved.");
      if (poolAddress === ZERO)
        throw new Error("The official factory reports no pool for this pair. Nothing was saved.");
      const poolLiquidity = await client.readContract({
        address: poolAddress,
        abi: uniswapV3PoolAbi,
        functionName: "liquidity",
      });
      if (poolLiquidity === 0n)
        throw new Error("The pool reports zero liquidity. Nothing was saved.");

      const { data: confirmed, error } = await db
        .from("liquidity_positions")
        .update({
          status: "confirmed",
          step: "done",
          pool_address: poolAddress.toLowerCase(),
          position_token_id: minted.tokenId.toString(),
          liquidity: pos[7].toString(),
          confirmed_at: new Date().toISOString(),
          failure_reason: null,
        })
        .eq("id", position.id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return {
        outcome: "confirmed" as const,
        position: confirmed,
        message: "Liquidity position verified through the official Uniswap factory.",
      };
    }

    const { data: advanced, error } = await db
      .from("liquidity_positions")
      .update({ step: next, status: "in_progress" })
      .eq("id", position.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return {
      outcome: "advanced" as const,
      position: advanced,
      message: `${step.replace("_", " ")} verified.`,
    };
  });

/** Abandons an unconfirmed plan. Approvals or WETH already on-chain stay in the wallet; nothing is hidden. */
export const resetLiquidity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { listingId: string }) => input)
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { data: position } = await db
      .from("liquidity_positions")
      .select("*")
      .eq("listing_id", data.listingId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!position) return { reset: false };
    if (position.status === "confirmed")
      throw new Error("A confirmed liquidity position cannot be reset.");
    if (position.mint_tx_hash)
      throw new Error("A mint transaction is recorded. Verify it before resetting.");
    const { error } = await db.from("liquidity_positions").delete().eq("id", position.id);
    if (error) throw new Error(error.message);
    return { reset: true };
  });

/* --------------------------------------------------------------- lock-up */

const MIN_LOCK_SECONDS = 180 * 24 * 60 * 60;

/** Resolves the configured locker and checks it is a real contract bound to the official position manager. */
async function requireLocker(
  client: Awaited<ReturnType<typeof requireInfra>>["client"],
  positionManager: string,
) {
  const { getAddress } = await import("viem");
  const { publicEnv } = await import("@/config/env");
  const configured = publicEnv.liquidityLockerAddress;
  if (!configured || !isHexAddress(configured)) {
    throw new Error(
      "VITE_LIQUIDITY_LOCKER_ADDRESS is not set, so liquidity cannot be locked. Deploy YardLiquidityLocker and configure its address first.",
    );
  }
  const locker = getAddress(configured);
  const code = await client.getBytecode({ address: locker });
  if (!code || code === "0x")
    throw new Error(`No contract exists at the configured locker address ${locker}.`);
  const bound = await client.readContract({
    address: locker,
    abi: liquidityLockerAbi,
    functionName: "positionManager",
  });
  if (getAddress(bound) !== getAddress(positionManager)) {
    throw new Error(
      "The configured locker is bound to a different Uniswap position manager. Locking is disabled.",
    );
  }
  const minimum = await client.readContract({
    address: locker,
    abi: liquidityLockerAbi,
    functionName: "MIN_LOCK_DURATION",
  });
  return { locker, minimum: Number(minimum) };
}

/** Builds the single transaction that transfers the position NFT into the locker. */
export const prepareLiquidityLock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { listingId: string; lockDays: number; permanent: boolean }) => {
    if (
      !input.permanent &&
      (!Number.isInteger(input.lockDays) || input.lockDays < 180 || input.lockDays > 3650)
    ) {
      throw new Error("A timed lock must be between 180 and 3650 days.");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    const { encodeAbiParameters, encodeFunctionData, getAddress } = await import("viem");
    const db = await admin();
    const { client } = await requireInfra();
    const { data: position } = await db
      .from("liquidity_positions")
      .select("*")
      .eq("listing_id", data.listingId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!position || position.status !== "confirmed" || !position.position_token_id) {
      throw new Error("Only a verified liquidity position can be locked.");
    }
    if (position.lock_verified_at) throw new Error("This position is already locked.");

    const pm = getAddress(position.position_manager);
    const wallet = getAddress(position.wallet_address);
    const positionId = BigInt(position.position_token_id);
    const { locker, minimum } = await requireLocker(client, pm);

    const owner = await client.readContract({
      address: pm,
      abi: nonfungiblePositionManagerAbi,
      functionName: "ownerOf",
      args: [positionId],
    });
    if (getAddress(owner) !== wallet)
      throw new Error("Your wallet no longer owns this position NFT, so it cannot be locked.");

    const duration = data.permanent
      ? 0
      : Math.max(data.lockDays * 24 * 60 * 60, Math.max(minimum, MIN_LOCK_SECONDS));
    const payload = encodeAbiParameters(
      [{ type: "uint64" }, { type: "bool" }],
      [BigInt(duration), data.permanent],
    );
    return {
      locker,
      positionId: positionId.toString(),
      permanent: data.permanent,
      lockSeconds: duration,
      unlockAtEstimate: data.permanent
        ? null
        : new Date(Date.now() + duration * 1000).toISOString(),
      to: pm,
      data: encodeFunctionData({
        abi: nonfungiblePositionManagerAbi,
        functionName: "safeTransferFrom",
        args: [wallet, locker, positionId, payload],
      }),
      description: data.permanent
        ? `Permanently locks position #${positionId.toString()} in ${locker}. It can never be withdrawn.`
        : `Locks position #${positionId.toString()} in ${locker} for ${Math.round(duration / 86400)} days. Only your wallet can withdraw it afterwards.`,
    };
  });

/** Stores the submitted lock transaction hash so a refresh can recover it. */
export const recordLiquidityLock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { listingId: string; txHash: string }) => {
    if (!isTxHash(input.txHash)) throw new Error("That is not a valid transaction hash.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { error } = await db
      .from("liquidity_positions")
      .update({ lock_tx_hash: data.txHash.toLowerCase() })
      .eq("listing_id", data.listingId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { recorded: true };
  });

/** Confirms the lock only when the locker actually owns the position NFT on-chain. */
export const verifyLiquidityLock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { listingId: string }) => input)
  .handler(async ({ data, context }) => {
    const { getAddress } = await import("viem");
    const db = await admin();
    const { client } = await requireInfra();
    const { data: position } = await db
      .from("liquidity_positions")
      .select("*")
      .eq("listing_id", data.listingId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!position || !position.position_token_id)
      throw new Error("There is no verified position to check.");
    if (!position.lock_tx_hash || !isTxHash(position.lock_tx_hash)) {
      return { outcome: "pending" as const, message: "No lock transaction has been recorded yet." };
    }

    const pm = getAddress(position.position_manager);
    const positionId = BigInt(position.position_token_id);
    const { locker } = await requireLocker(client, pm);

    let receipt;
    try {
      receipt = await client.waitForTransactionReceipt({
        hash: position.lock_tx_hash as `0x${string}`,
        timeout: 60_000,
        pollingInterval: 2_000,
      });
    } catch {
      return {
        outcome: "pending" as const,
        message: "The lock transaction has not been mined yet. Check again shortly.",
      };
    }
    if (receipt.status !== "success") {
      await db.from("liquidity_positions").update({ lock_tx_hash: null }).eq("id", position.id);
      return {
        outcome: "failed" as const,
        message: "The lock transaction reverted. Nothing was saved.",
      };
    }

    const owner = await client.readContract({
      address: pm,
      abi: nonfungiblePositionManagerAbi,
      functionName: "ownerOf",
      args: [positionId],
    });
    if (getAddress(owner) !== locker)
      throw new Error(
        "The locker does not own the position NFT, so the liquidity is NOT locked. Nothing was saved.",
      );
    const info = await client.readContract({
      address: locker,
      abi: liquidityLockerAbi,
      functionName: "lockInfo",
      args: [positionId],
    });
    if (getAddress(info.depositor) !== getAddress(position.wallet_address)) {
      throw new Error("The lock was recorded for a different depositor. Nothing was saved.");
    }
    if (info.withdrawn)
      throw new Error("The locker reports this position as already withdrawn. Nothing was saved.");
    const stillLocked = await client.readContract({
      address: locker,
      abi: liquidityLockerAbi,
      functionName: "isLocked",
      args: [positionId],
    });
    if (!stillLocked)
      throw new Error(
        "The locker does not report an active lock for this position. Nothing was saved.",
      );

    const permanent = info.permanent;
    const unlockAt = permanent ? null : new Date(Number(info.unlockAt) * 1000).toISOString();
    const { data: saved, error } = await db
      .from("liquidity_positions")
      .update({
        locker_address: locker.toLowerCase(),
        lock_permanent: permanent,
        lock_unlock_at: unlockAt,
        lock_verified_at: new Date().toISOString(),
      })
      .eq("id", position.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return {
      outcome: "locked" as const,
      position: saved,
      message: permanent
        ? `Position #${positionId.toString()} is permanently locked in ${locker}.`
        : `Position #${positionId.toString()} is locked in ${locker} until ${unlockAt}.`,
    };
  });

/* -------------------------------------------- locked position: fees & exit */

/** Live, verified state of a locked position. Never claims a lock the chain does not confirm. */
export const getLockState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { listingId: string }) => input)
  .handler(async ({ data, context }) => {
    const { getAddress } = await import("viem");
    const db = await admin();
    const { client } = await requireInfra();
    const { data: position } = await db
      .from("liquidity_positions")
      .select("*")
      .eq("listing_id", data.listingId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!position?.position_token_id) return { known: false as const };
    return readLockState(client, position);
  });

type LockStateInput = {
  position_manager: string;
  position_token_id: string | null;
  locker_address: string | null;
  wallet_address: string;
};

/** Shared reader used by the launchpad and the public token page. */
export async function readLockState(
  client: Awaited<ReturnType<typeof requireInfra>>["client"],
  position: LockStateInput,
) {
  const { getAddress } = await import("viem");
  if (!position.position_token_id) throw new Error("This position has no verified position NFT yet.");
  const pm = getAddress(position.position_manager);
  const positionId = BigInt(position.position_token_id);
  const currentOwner = await client
    .readContract({
      address: pm,
      abi: nonfungiblePositionManagerAbi,
      functionName: "ownerOf",
      args: [positionId],
    })
    .catch(() => null);

  if (!position.locker_address) {
    return {
      known: true as const,
      locked: false,
      positionId: positionId.toString(),
      locker: null,
      currentOwner: currentOwner ? getAddress(currentOwner) : null,
      depositor: null,
      permanent: false,
      unlockAt: null as string | null,
      withdrawn: false,
      withdrawable: false,
      collected: null as { amount0: string; amount1: string } | null,
      owed: null as { amount0: string; amount1: string } | null,
    };
  }

  const locker = getAddress(position.locker_address);
  const [info, isLocked, collected, pos] = await Promise.all([
    client.readContract({
      address: locker,
      abi: liquidityLockerAbi,
      functionName: "lockInfo",
      args: [positionId],
    }),
    client.readContract({
      address: locker,
      abi: liquidityLockerAbi,
      functionName: "isLocked",
      args: [positionId],
    }),
    client.readContract({
      address: locker,
      abi: liquidityLockerAbi,
      functionName: "collectedFees",
      args: [positionId],
    }),
    client.readContract({
      address: pm,
      abi: nonfungiblePositionManagerAbi,
      functionName: "positions",
      args: [positionId],
    }),
  ]);
  const unlockAt = info.permanent ? null : new Date(Number(info.unlockAt) * 1000).toISOString();
  return {
    known: true as const,
    locked: Boolean(isLocked) && currentOwner !== null && getAddress(currentOwner) === locker,
    positionId: positionId.toString(),
    locker,
    currentOwner: currentOwner ? getAddress(currentOwner) : null,
    depositor: getAddress(info.depositor),
    permanent: info.permanent,
    unlockAt,
    withdrawn: info.withdrawn,
    withdrawable:
      !info.permanent && !info.withdrawn && Number(info.unlockAt) * 1000 <= Date.now(),
    collected: { amount0: collected[0].toString(), amount1: collected[1].toString() },
    owed: { amount0: pos[10].toString(), amount1: pos[11].toString() },
  };
}

async function loadLockedPosition(
  db: Awaited<ReturnType<typeof admin>>,
  userId: string,
  listingId: string,
) {
  const { data: position } = await db
    .from("liquidity_positions")
    .select("*")
    .eq("listing_id", listingId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!position?.position_token_id || !position.locker_address || !position.lock_verified_at) {
    throw new Error("There is no verified locked position for this listing.");
  }
  return position;
}

/** Builds the depositor-only fee collection call. Fees always go to the depositor. */
export const prepareFeeCollection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { listingId: string }) => input)
  .handler(async ({ data, context }) => {
    const { encodeFunctionData, getAddress } = await import("viem");
    const db = await admin();
    const { client } = await requireInfra();
    const position = await loadLockedPosition(db, context.userId, data.listingId);
    if (position.collect_fees_tx_hash) {
      return {
        pendingTxHash: position.collect_fees_tx_hash,
        to: null,
        data: null,
        description: "A fee collection is already pending verification.",
      };
    }
    const state = await readLockState(client, position);
    if (!state.known || !state.locked)
      throw new Error("The locker does not currently hold this position, so there is nothing to collect from.");
    if (state.depositor && getAddress(state.depositor) !== getAddress(position.wallet_address))
      throw new Error("Only the original depositor wallet can collect fees for this position.");
    const owed0 = BigInt(state.owed?.amount0 ?? "0");
    const owed1 = BigInt(state.owed?.amount1 ?? "0");
    if (owed0 === 0n && owed1 === 0n)
      throw new Error("No trading fees have accrued to this position yet.");

    const MAX_UINT128 = 2n ** 128n - 1n;
    return {
      pendingTxHash: null,
      to: getAddress(position.locker_address!),
      data: encodeFunctionData({
        abi: liquidityLockerAbi,
        functionName: "collectFees",
        args: [BigInt(position.position_token_id!), MAX_UINT128, MAX_UINT128],
      }),
      owed: { amount0: owed0.toString(), amount1: owed1.toString() },
      description:
        "Collects the accrued Uniswap trading fees. They are sent to your depositor wallet; the position NFT stays locked.",
    };
  });

/** Builds the depositor-only withdrawal call for an expired timed lock. */
export const prepareLockWithdrawal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { listingId: string }) => input)
  .handler(async ({ data, context }) => {
    const { encodeFunctionData, getAddress } = await import("viem");
    const db = await admin();
    const { client } = await requireInfra();
    const position = await loadLockedPosition(db, context.userId, data.listingId);
    if (position.withdraw_tx_hash) {
      return {
        pendingTxHash: position.withdraw_tx_hash,
        to: null,
        data: null,
        description: "A withdrawal is already pending verification.",
      };
    }
    const state = await readLockState(client, position);
    if (!state.known || !state.locked) throw new Error("This position is not currently locked.");
    if (state.permanent)
      throw new Error("This lock is permanent. The position can never be withdrawn, by anyone.");
    if (!state.withdrawable)
      throw new Error(`The lock does not expire until ${state.unlockAt}. Nothing can be withdrawn before then.`);
    if (state.depositor && getAddress(state.depositor) !== getAddress(position.wallet_address))
      throw new Error("Only the original depositor wallet can withdraw this position.");

    return {
      pendingTxHash: null,
      to: getAddress(position.locker_address!),
      data: encodeFunctionData({
        abi: liquidityLockerAbi,
        functionName: "withdraw",
        args: [BigInt(position.position_token_id!)],
      }),
      description: `Returns position #${position.position_token_id} to your wallet. The lock has expired.`,
    };
  });

/** Records either locker transaction so a refresh can recover and verify it. */
export const recordLockerTx = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { listingId: string; kind: "collect" | "withdraw"; txHash: string }) => {
    if (!isTxHash(input.txHash)) throw new Error("That is not a valid transaction hash.");
    if (input.kind !== "collect" && input.kind !== "withdraw")
      throw new Error("Unknown locker action.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const db = await admin();
    const update: LiquidityUpdate =
      data.kind === "collect"
        ? { collect_fees_tx_hash: data.txHash.toLowerCase() }
        : { withdraw_tx_hash: data.txHash.toLowerCase() };
    const { error } = await db
      .from("liquidity_positions")
      .update(update)
      .eq("listing_id", data.listingId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { recorded: true };
  });

/**
 * Verifies a fee collection or a withdrawal exhaustively: sender, target, decoded call,
 * arguments, emitted event and the resulting live ownership. Handles reverted or replaced
 * transactions by clearing the pending hash instead of inventing a result.
 */
export const reconcileLockerTx = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { listingId: string; kind: "collect" | "withdraw" }) => input)
  .handler(async ({ data, context }) => {
    const { decodeEventLog, decodeFunctionData, getAddress } = await import("viem");
    const db = await admin();
    const { client } = await requireInfra();
    const position = await loadLockedPosition(db, context.userId, data.listingId);
    const column = data.kind === "collect" ? "collect_fees_tx_hash" : "withdraw_tx_hash";
    const hash = position[column];
    if (!hash || !isTxHash(hash))
      return { outcome: "pending" as const, message: "No transaction has been recorded yet." };

    const locker = getAddress(position.locker_address!);
    const wallet = getAddress(position.wallet_address);
    const positionId = BigInt(position.position_token_id!);
    const pm = getAddress(position.position_manager);

    let receipt;
    try {
      receipt = await client.waitForTransactionReceipt({
        hash: hash as `0x${string}`,
        timeout: 60_000,
        pollingInterval: 2_000,
      });
    } catch {
      return {
        outcome: "pending" as const,
        message: "The transaction has not been mined yet. Check again shortly.",
      };
    }
    if (receipt.status !== "success") {
      const cleared: LiquidityUpdate = {};
      cleared[column] = null;
      await db.from("liquidity_positions").update(cleared).eq("id", position.id);
      return { outcome: "failed" as const, message: "That transaction reverted. Nothing was saved." };
    }

    const tx = await client.getTransaction({ hash: hash as `0x${string}` });
    if (getAddress(tx.from) !== wallet)
      throw new Error("That transaction was not sent by the depositor wallet. Nothing was saved.");
    if (!tx.to || getAddress(tx.to) !== locker)
      throw new Error("That transaction was not sent to the verified locker. Nothing was saved.");
    if (tx.value !== 0n)
      throw new Error("That transaction carried ETH, which this call never does. Nothing was saved.");
    const call = decodeFunctionData({ abi: liquidityLockerAbi, data: tx.input });
    const expectedFn = data.kind === "collect" ? "collectFees" : "withdraw";
    if (call.functionName !== expectedFn)
      throw new Error(`That transaction called ${call.functionName}, not ${expectedFn}. Nothing was saved.`);
    if ((call.args as readonly unknown[])[0] !== positionId)
      throw new Error("That transaction is for a different position. Nothing was saved.");

    let event: { amount0?: bigint; amount1?: bigint } | null = null;
    for (const log of receipt.logs) {
      if (getAddress(log.address) !== locker) continue;
      try {
        const decoded = decodeEventLog({
          abi: liquidityLockerAbi,
          data: log.data,
          topics: log.topics,
        });
        const args = decoded.args as unknown as {
          positionId: bigint;
          depositor: string;
          amount0?: bigint;
          amount1?: bigint;
        };
        if (args.positionId !== positionId) continue;
        if (getAddress(args.depositor) !== wallet) continue;
        if (data.kind === "collect" && decoded.eventName === "FeesCollected") {
          event = args;
          break;
        }
        if (data.kind === "withdraw" && decoded.eventName === "PositionWithdrawn") {
          event = args;
          break;
        }
      } catch {
        continue;
      }
    }
    if (!event)
      throw new Error(
        `The transaction succeeded but the locker emitted no ${expectedFn} event for this position and depositor. Nothing was saved.`,
      );

    const owner = await client.readContract({
      address: pm,
      abi: nonfungiblePositionManagerAbi,
      functionName: "ownerOf",
      args: [positionId],
    });

    if (data.kind === "collect") {
      if (getAddress(owner) !== locker)
        throw new Error("The locker no longer holds the position NFT. Nothing was saved.");
      const collected = await client.readContract({
        address: locker,
        abi: liquidityLockerAbi,
        functionName: "collectedFees",
        args: [positionId],
      });
      const { data: saved, error } = await db
        .from("liquidity_positions")
        .update({
          collect_fees_tx_hash: null,
          collected_amount0: collected[0].toString(),
          collected_amount1: collected[1].toString(),
          fees_collected_at: new Date().toISOString(),
        })
        .eq("id", position.id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return {
        outcome: "collected" as const,
        position: saved,
        message: "Trading fees were collected to your wallet. The position is still locked.",
      };
    }

    if (getAddress(owner) !== wallet)
      throw new Error("The position NFT is not back in your wallet. Nothing was saved.");
    const { data: saved, error } = await db
      .from("liquidity_positions")
      .update({
        withdraw_tx_hash: null,
        lock_withdrawn_at: new Date().toISOString(),
        lock_verified_at: null,
      })
      .eq("id", position.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return {
      outcome: "withdrawn" as const,
      position: saved,
      message: `Position #${positionId.toString()} is back in your wallet. The liquidity is no longer locked.`,
    };
  });
