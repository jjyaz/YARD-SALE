import { createServerFn } from "@tanstack/react-start";
import type { Log, decodeEventLog as DecodeEventLog, getAddress as GetAddress } from "viem";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { isHexAddress } from "@/config/env";
import { companionTokenAbi } from "@/lib/abi";
import { nonfungiblePositionManagerAbi, uniswapV3FactoryAbi, uniswapV3PoolAbi, weth9Abi } from "@/lib/uniswap-abi";
import { buildLiquidityPlan, parseFixed, priceFromSqrtPriceX96 } from "@/lib/uniswap-math";

type LiquidityUpdate = Database["public"]["Tables"]["liquidity_positions"]["Update"];
type IncreaseLiquidityArgs = { tokenId: bigint; liquidity: bigint; amount0: bigint; amount1: bigint };

function findIncreaseLiquidity(
  logs: readonly Log[],
  positionManager: `0x${string}`,
  decode: typeof DecodeEventLog,
  checksum: typeof GetAddress,
): IncreaseLiquidityArgs | null {
  for (const log of logs) {
    if (checksum(log.address) !== positionManager) continue;
    try {
      const decoded = decode({ abi: nonfungiblePositionManagerAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === "IncreaseLiquidity") return decoded.args as unknown as IncreaseLiquidityArgs;
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

export type LiquidityStep = "wrap" | "approve_weth" | "approve_token" | "create_pool" | "mint" | "done";
const STEP_ORDER: LiquidityStep[] = ["wrap", "approve_weth", "approve_token", "create_pool", "mint", "done"];
const STEP_TX_COLUMN: Record<Exclude<LiquidityStep, "done">, "wrap_tx_hash" | "weth_approve_tx_hash" | "token_approve_tx_hash" | "pool_tx_hash" | "mint_tx_hash"> = {
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

async function loadVerifiedToken(db: Awaited<ReturnType<typeof admin>>, userId: string, listingId: string) {
  const { data: token } = await db.from("companion_tokens").select("*").eq("listing_id", listingId).eq("user_id", userId).maybeSingle();
  if (!token || token.status !== "confirmed" || !token.token_address) {
    throw new Error("Only a verified Companion Token can be paired with liquidity.");
  }
  return token;
}

async function requireInfra() {
  const { verifyLiquidityInfra, requireVerifiedDeployment, rpcClient } = await import("@/lib/launchpad.server");
  const deployment = await requireVerifiedDeployment();
  const infra = await verifyLiquidityInfra();
  if (!infra.available) {
    const blocker = infra.checks.find((c) => !c.ok);
    throw new Error(blocker ? `${blocker.label}: ${blocker.detail}` : "Uniswap infrastructure is not available.");
  }
  return { deployment, infra, client: rpcClient(infra.chainId) };
}

/* ------------------------------------------------------------------ preview */

export const previewLiquidity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { listingId: string; wallet: string; tokenAmount: string; ethAmount: string; slippageBps: number }) => {
    if (!isHexAddress(input.wallet)) throw new Error("Wallet is not a valid address.");
    if (!Number.isInteger(input.slippageBps) || input.slippageBps < 10 || input.slippageBps > 2000) {
      throw new Error("Slippage must be between 0.1% and 20%.");
    }
    return input;
  })
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
    const [ethBalance, tokenBalance, wethBalance, wethAllowance, tokenAllowance, poolAddress, gasPrice] = await Promise.all([
      client.getBalance({ address: wallet }),
      client.readContract({ address: tokenAddress, abi: companionTokenAbi, functionName: "balanceOf", args: [wallet] }),
      client.readContract({ address: weth, abi: weth9Abi, functionName: "balanceOf", args: [wallet] }),
      client.readContract({ address: weth, abi: weth9Abi, functionName: "allowance", args: [wallet, pm] }),
      client.readContract({ address: tokenAddress, abi: companionTokenAbi, functionName: "allowance", args: [wallet, pm] }),
      client.readContract({ address: infra.factory as `0x${string}`, abi: uniswapV3FactoryAbi, functionName: "getPool", args: [plan.token0, plan.token1, infra.feeTier] }),
      client.getGasPrice(),
    ]);

    let existingPool: { address: string; initialized: boolean; priceToken1PerToken0: string | null; liquidity: string } | null = null;
    if (poolAddress !== ZERO) {
      const [slot0, liquidity] = await Promise.all([
        client.readContract({ address: poolAddress, abi: uniswapV3PoolAbi, functionName: "slot0" }),
        client.readContract({ address: poolAddress, abi: uniswapV3PoolAbi, functionName: "liquidity" }),
      ]);
      existingPool = {
        address: poolAddress,
        initialized: slot0[0] !== 0n,
        priceToken1PerToken0: slot0[0] !== 0n ? priceFromSqrtPriceX96(slot0[0]) : null,
        liquidity: liquidity.toString(),
      };
    }

    const wrapNeeded = ethAmount > wethBalance ? ethAmount - wethBalance : 0n;
    const steps: { step: LiquidityStep; label: string; needed: boolean; gasEstimate: bigint | null }[] = [];
    const estimate = async (fn: () => Promise<bigint>) => {
      try {
        return await fn();
      } catch {
        return null;
      }
    };
    steps.push({
      step: "wrap",
      label: wrapNeeded > 0n ? `Wrap ${formatEther(wrapNeeded)} ETH into WETH` : "Wrap ETH (already have enough WETH)",
      needed: wrapNeeded > 0n,
      gasEstimate:
        wrapNeeded > 0n && ethBalance >= wrapNeeded
          ? await estimate(() => client.estimateContractGas({ address: weth, abi: weth9Abi, functionName: "deposit", account: wallet, value: wrapNeeded }))
          : null,
    });
    steps.push({
      step: "approve_weth",
      label: `Approve exactly ${formatEther(ethAmount)} WETH for the position manager`,
      needed: wethAllowance < ethAmount,
      gasEstimate: wethAllowance < ethAmount ? await estimate(() => client.estimateContractGas({ address: weth, abi: weth9Abi, functionName: "approve", args: [pm, ethAmount], account: wallet })) : null,
    });
    steps.push({
      step: "approve_token",
      label: `Approve exactly ${data.tokenAmount} ${token.symbol} for the position manager`,
      needed: tokenAllowance < tokenAmount,
      gasEstimate:
        tokenAllowance < tokenAmount
          ? await estimate(() => client.estimateContractGas({ address: tokenAddress, abi: companionTokenAbi, functionName: "approve", args: [pm, tokenAmount], account: wallet }))
          : null,
    });
    steps.push({
      step: "create_pool",
      label: existingPool?.initialized ? "Pool already exists and is initialised (your ratio will NOT set the price)" : "Create and initialise the 0.3% pool at your opening price",
      needed: !existingPool?.initialized,
      gasEstimate: existingPool?.initialized ? null : FALLBACK_GAS.create_pool,
    });
    steps.push({ step: "mint", label: "Mint the full-range liquidity position", needed: true, gasEstimate: FALLBACK_GAS.mint });

    const totalGas = steps.reduce((sum, s) => sum + (s.needed && s.gasEstimate ? s.gasEstimate : 0n), 0n);
    const feeEstimateWei = totalGas * gasPrice;
    const ethNeeded = wrapNeeded + feeEstimateWei;

    return {
      chainId: infra.chainId,
      token: { address: tokenAddress, symbol: token.symbol, name: token.name, totalSupply: String(token.total_supply) },
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
        tokenBalance < tokenAmount ? `Your wallet holds ${formatEther(tokenBalance)} ${token.symbol}, less than the ${data.tokenAmount} you want to deposit.` : null,
        ethBalance < ethNeeded ? `Your wallet holds ${formatEther(ethBalance)} ETH; about ${formatEther(ethNeeded)} ETH is needed for the deposit plus gas.` : null,
        existingPool?.initialized
          ? `A pool for this pair already exists at ${existingPool.priceToken1PerToken0} ${plan.tokenIsToken0 ? "WETH per token" : "tokens per WETH"}. Your amounts will be adjusted to that price and any excess stays in your wallet.`
          : null,
      ].filter((p): p is string => Boolean(p)),
    };
  });

/* --------------------------------------------------------------- start plan */

export const startLiquidity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { listingId: string; wallet: string; tokenAmount: string; ethAmount: string; slippageBps: number; risksAccepted: boolean }) => {
    if (!isHexAddress(input.wallet)) throw new Error("Wallet is not a valid address.");
    if (!input.risksAccepted) throw new Error("You must accept every liquidity risk statement.");
    if (!Number.isInteger(input.slippageBps) || input.slippageBps < 10 || input.slippageBps > 2000) throw new Error("Slippage must be between 0.1% and 20%.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { getAddress } = await import("viem");
    const db = await admin();
    const token = await loadVerifiedToken(db, context.userId, data.listingId);
    const { infra } = await requireInfra();
    const { data: wallets } = await db.from("wallets").select("address").eq("user_id", context.userId);
    if (!(wallets ?? []).some((w) => w.address.toLowerCase() === data.wallet.toLowerCase())) {
      throw new Error("The connected wallet is not linked to this account.");
    }
    if (getAddress(token.wallet_address) !== getAddress(data.wallet)) {
      throw new Error("Only the wallet that created the token can launch its liquidity from here.");
    }

    const { data: existing } = await db.from("liquidity_positions").select("*").eq("token_id", token.id).maybeSingle();
    if (existing?.status === "confirmed") throw new Error("Liquidity has already been launched for this token.");
    if (existing && existing.status === "in_progress" && existing.step !== "wrap") {
      throw new Error("A liquidity launch is already in progress. Continue it below or reset it first.");
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
      amount0_min: plan.amount0Min.toString(),
      amount1_min: plan.amount1Min.toString(),
      slippage_bps: data.slippageBps,
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
    const { data: position } = await db.from("liquidity_positions").select("*").eq("listing_id", data.listingId).eq("user_id", context.userId).maybeSingle();
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
      return { step, skip: false as const, pendingTxHash: pendingHash, to: null, data: null, value: null, description: "A transaction for this step is pending verification." };
    }

    const [wethBalance, wethAllowance, tokenAllowance, poolAddress] = await Promise.all([
      client.readContract({ address: weth, abi: weth9Abi, functionName: "balanceOf", args: [wallet] }),
      client.readContract({ address: weth, abi: weth9Abi, functionName: "allowance", args: [wallet, pm] }),
      client.readContract({ address: tokenAddress, abi: companionTokenAbi, functionName: "allowance", args: [wallet, pm] }),
      client.readContract({ address: getAddress(position.factory_address), abi: uniswapV3FactoryAbi, functionName: "getPool", args: [token0, token1, position.fee_tier] }),
    ]);

    const advance = async (next: LiquidityStep) => {
      await db.from("liquidity_positions").update({ step: next, status: "in_progress" }).eq("id", position.id);
    };

    if (step === "wrap") {
      const shortfall = ethAmount > wethBalance ? ethAmount - wethBalance : 0n;
      if (shortfall === 0n) {
        await advance("approve_weth");
        return { step, skip: true as const, description: "You already hold enough WETH; nothing to wrap." };
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
        data: encodeFunctionData({ abi: companionTokenAbi, functionName: "approve", args: [pm, tokenAmount] }),
        value: null,
        description: `Approve exactly ${formatEther(tokenAmount)} tokens — not unlimited.`,
      };
    }
    if (step === "create_pool") {
      if (poolAddress !== ZERO) {
        const slot0 = await client.readContract({ address: poolAddress, abi: uniswapV3PoolAbi, functionName: "slot0" });
        if (slot0[0] !== 0n) {
          await db.from("liquidity_positions").update({ step: "mint", status: "in_progress", pool_address: poolAddress.toLowerCase() }).eq("id", position.id);
          return { step, skip: true as const, description: `The pool already exists at ${poolAddress} and is initialised.` };
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
    if (wethBalance < ethAmount) throw new Error(`Your WETH balance (${formatEther(wethBalance)}) dropped below the planned ${formatEther(ethAmount)}. Reset the plan.`);
    if (wethAllowance < ethAmount || tokenAllowance < tokenAmount) throw new Error("An approval is missing or was reduced. Reset the plan and run the approvals again.");
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
      data: encodeFunctionData({ abi: nonfungiblePositionManagerAbi, functionName: "mint", args: [params] }),
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
    const { data: position } = await db.from("liquidity_positions").select("*").eq("listing_id", data.listingId).eq("user_id", context.userId).maybeSingle();
    if (!position) throw new Error("Start the liquidity plan first.");
    if (position.step !== data.step) throw new Error(`The plan is at step "${position.step}", not "${data.step}".`);
    const column = STEP_TX_COLUMN[data.step as Exclude<LiquidityStep, "done">];
    if (position[column] && position[column] !== data.txHash) throw new Error("A different transaction is already recorded for this step.");
    const update: LiquidityUpdate = { status: "in_progress", failure_reason: null };
    update[column] = data.txHash;
    const { data: saved, error } = await db.from("liquidity_positions").update(update).eq("id", position.id).select("*").single();
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
    const { data: position } = await db.from("liquidity_positions").select("*").eq("listing_id", data.listingId).eq("user_id", context.userId).maybeSingle();
    if (!position) throw new Error("Start the liquidity plan first.");
    if (position.status === "confirmed") return { outcome: "confirmed" as const, position, message: "Already verified." };

    const step = position.step as LiquidityStep;
    if (step === "done") throw new Error("Unexpected state: no step to verify.");
    const column = STEP_TX_COLUMN[step];
    const hash = position[column];
    if (!hash || !isTxHash(hash)) return { outcome: "pending" as const, position, message: "No transaction recorded for the current step." };

    let receipt;
    try {
      receipt = await client.waitForTransactionReceipt({ hash, timeout: 60_000, pollingInterval: 2_000 });
    } catch {
      return { outcome: "pending" as const, position, message: "The transaction has not been mined yet. Check again shortly." };
    }
    if (receipt.status !== "success") {
      const failedUpdate: LiquidityUpdate = { status: "failed", failure_reason: `The ${step.replace("_", " ")} transaction reverted on-chain.` };
      failedUpdate[column] = null;
      const { data: failed } = await db.from("liquidity_positions").update(failedUpdate).eq("id", position.id).select("*").single();
      return { outcome: "failed" as const, position: failed, message: `The ${step.replace("_", " ")} transaction reverted.` };
    }

    const wallet = getAddress(position.wallet_address);
    const pm = getAddress(position.position_manager);
    const weth = getAddress(position.weth_address);
    const tokenAddress = getAddress(position.token_address);
    const token0 = getAddress(position.token0);
    const token1 = getAddress(position.token1);
    const nextIndex = STEP_ORDER.indexOf(step) + 1;
    const next = STEP_ORDER[nextIndex] as LiquidityStep;

    // Verify the effect of each step against live state, not just the receipt.
    if (step === "wrap") {
      const balance = await client.readContract({ address: weth, abi: weth9Abi, functionName: "balanceOf", args: [wallet] });
      if (balance < BigInt(position.eth_amount)) throw new Error("The wrap was mined but the WETH balance is still below the planned amount. Nothing advanced.");
    } else if (step === "approve_weth") {
      const allowance = await client.readContract({ address: weth, abi: weth9Abi, functionName: "allowance", args: [wallet, pm] });
      if (allowance < BigInt(position.eth_amount)) throw new Error("The approval was mined but the WETH allowance is still insufficient. Nothing advanced.");
    } else if (step === "approve_token") {
      const allowance = await client.readContract({ address: tokenAddress, abi: companionTokenAbi, functionName: "allowance", args: [wallet, pm] });
      if (allowance < BigInt(position.token_amount)) throw new Error("The approval was mined but the token allowance is still insufficient. Nothing advanced.");
    } else if (step === "create_pool") {
      const poolAddress = await client.readContract({ address: getAddress(position.factory_address), abi: uniswapV3FactoryAbi, functionName: "getPool", args: [token0, token1, position.fee_tier] });
      if (poolAddress === ZERO) throw new Error("The transaction was mined but the official factory reports no pool for this pair. Nothing advanced.");
      const [slot0, pToken0, pToken1, pFee, pFactory] = await Promise.all([
        client.readContract({ address: poolAddress, abi: uniswapV3PoolAbi, functionName: "slot0" }),
        client.readContract({ address: poolAddress, abi: uniswapV3PoolAbi, functionName: "token0" }),
        client.readContract({ address: poolAddress, abi: uniswapV3PoolAbi, functionName: "token1" }),
        client.readContract({ address: poolAddress, abi: uniswapV3PoolAbi, functionName: "fee" }),
        client.readContract({ address: poolAddress, abi: uniswapV3PoolAbi, functionName: "factory" }),
      ]);
      if (slot0[0] === 0n) throw new Error("The pool exists but is not initialised. Nothing advanced.");
      if (getAddress(pToken0) !== token0 || getAddress(pToken1) !== token1 || Number(pFee) !== position.fee_tier || getAddress(pFactory) !== getAddress(infra.factory)) {
        throw new Error("The pool's tokens, fee or factory do not match the plan. Nothing advanced.");
      }
      await db.from("liquidity_positions").update({ pool_address: poolAddress.toLowerCase() }).eq("id", position.id);
    } else if (step === "mint") {
      const minted = findIncreaseLiquidity(receipt.logs, pm, decodeEventLog, getAddress);
      if (!minted) throw new Error("The transaction succeeded but no IncreaseLiquidity event was emitted by the position manager. Nothing was saved.");
      const [owner, pos, poolAddress] = await Promise.all([
        client.readContract({ address: pm, abi: nonfungiblePositionManagerAbi, functionName: "ownerOf", args: [minted.tokenId] }),
        client.readContract({ address: pm, abi: nonfungiblePositionManagerAbi, functionName: "positions", args: [minted.tokenId] }),
        client.readContract({ address: getAddress(position.factory_address), abi: uniswapV3FactoryAbi, functionName: "getPool", args: [token0, token1, position.fee_tier] }),
      ]);
      if (getAddress(owner) !== wallet) throw new Error("The position NFT is not owned by your wallet. Nothing was saved.");
      if (getAddress(pos[2]) !== token0 || getAddress(pos[3]) !== token1 || Number(pos[4]) !== position.fee_tier || pos[5] !== position.tick_lower || pos[6] !== position.tick_upper) {
        throw new Error("The minted position does not match the plan (tokens, fee or ticks). Nothing was saved.");
      }
      if (pos[7] === 0n || minted.liquidity === 0n) throw new Error("The position has zero liquidity. Nothing was saved.");
      if (poolAddress === ZERO) throw new Error("The official factory reports no pool for this pair. Nothing was saved.");
      const poolLiquidity = await client.readContract({ address: poolAddress, abi: uniswapV3PoolAbi, functionName: "liquidity" });
      if (poolLiquidity === 0n) throw new Error("The pool reports zero liquidity. Nothing was saved.");

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
      return { outcome: "confirmed" as const, position: confirmed, message: "Liquidity position verified through the official Uniswap factory." };
    }

    const { data: advanced, error } = await db.from("liquidity_positions").update({ step: next, status: "in_progress" }).eq("id", position.id).select("*").single();
    if (error) throw new Error(error.message);
    return { outcome: "advanced" as const, position: advanced, message: `${step.replace("_", " ")} verified.` };
  });

/** Abandons an unconfirmed plan. Approvals or WETH already on-chain stay in the wallet; nothing is hidden. */
export const resetLiquidity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { listingId: string }) => input)
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { data: position } = await db.from("liquidity_positions").select("*").eq("listing_id", data.listingId).eq("user_id", context.userId).maybeSingle();
    if (!position) return { reset: false };
    if (position.status === "confirmed") throw new Error("A confirmed liquidity position cannot be reset.");
    if (position.mint_tx_hash) throw new Error("A mint transaction is recorded. Verify it before resetting.");
    const { error } = await db.from("liquidity_positions").delete().eq("id", position.id);
    if (error) throw new Error(error.message);
    return { reset: true };
  });
