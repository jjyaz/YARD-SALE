/**
 * Integer-safe Uniswap v3 helpers. Pure functions, no I/O, fully unit-tested.
 * All amounts are base units (wei / 18-decimal token units) as bigint.
 */

export const Q96 = 2n ** 96n;
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;
/** Uniswap v3 hard bounds for sqrtPriceX96 (from TickMath). */
export const MIN_SQRT_RATIO = 4295128739n;
export const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n;

/** Floor square root for arbitrary-size bigints (Newton's method, monotonically decreasing from an over-estimate). */
export function sqrtBigInt(value: bigint): bigint {
  if (value < 0n) throw new Error("Cannot take the square root of a negative number.");
  if (value < 2n) return value;
  let x = value;
  let y = (value + 1n) >> 1n;
  while (y < x) {
    x = y;
    y = (x + value / x) >> 1n;
  }
  return x;
}

/** Uniswap sorts pools by token address (lowercase hex compares like uint160). */
export function sortTokens(
  a: string,
  b: string,
): { token0: `0x${string}`; token1: `0x${string}`; flipped: boolean } {
  const la = a.toLowerCase() as `0x${string}`;
  const lb = b.toLowerCase() as `0x${string}`;
  if (la === lb) throw new Error("Both tokens are the same address.");
  return BigInt(la) < BigInt(lb)
    ? { token0: la, token1: lb, flipped: false }
    : { token0: lb, token1: la, flipped: true };
}

/**
 * sqrtPriceX96 = sqrt(amount1 / amount0) * 2^96, computed as
 * sqrt(amount1 * 2^192 / amount0) so no precision is lost to floating point.
 */
export function encodeSqrtPriceX96(amount1: bigint, amount0: bigint): bigint {
  if (amount0 <= 0n || amount1 <= 0n) throw new Error("Both amounts must be positive.");
  const ratioX192 = (amount1 << 192n) / amount0;
  const sqrt = sqrtBigInt(ratioX192);
  if (sqrt < MIN_SQRT_RATIO || sqrt >= MAX_SQRT_RATIO) {
    throw new Error(
      "The opening ratio is outside the range Uniswap v3 can represent. Change the amounts.",
    );
  }
  return sqrt;
}

/** Price of token0 in token1 (as a decimal string with 18 fractional digits) from sqrtPriceX96. */
export function priceFromSqrtPriceX96(sqrtPriceX96: bigint, fractionDigits = 18): string {
  const scale = 10n ** BigInt(fractionDigits);
  const numerator = sqrtPriceX96 * sqrtPriceX96 * scale;
  const value = numerator / (Q96 * Q96);
  return formatFixed(value, fractionDigits);
}

/** Largest tick range usable for a given tick spacing (full-range position). */
export function fullRangeTicks(tickSpacing: number): { tickLower: number; tickUpper: number } {
  if (!Number.isInteger(tickSpacing) || tickSpacing <= 0) throw new Error("Invalid tick spacing.");
  const tickLower = Math.ceil(MIN_TICK / tickSpacing) * tickSpacing;
  const tickUpper = Math.floor(MAX_TICK / tickSpacing) * tickSpacing;
  return { tickLower, tickUpper };
}

export function applySlippage(amount: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) {
    throw new Error("Slippage must be between 0 and 10000 basis points.");
  }
  return (amount * BigInt(10_000 - slippageBps)) / 10_000n;
}

/** Format a base-unit amount as a decimal string, trimming trailing zeros. */
export function formatFixed(value: bigint, decimals = 18, maxFraction = decimals): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  let fraction = (abs % base).toString().padStart(decimals, "0");
  fraction = fraction.slice(0, maxFraction).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}${fraction ? `.${fraction}` : ""}`;
}

/** Parse a decimal string into base units. Rejects anything that is not a plain decimal number. */
export function parseFixed(value: string, decimals = 18): bigint {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error(`"${value}" is not a valid amount.`);
  const dot = trimmed.indexOf(".");
  const wholePart = dot === -1 ? trimmed : trimmed.slice(0, dot);
  const fractionPart = dot === -1 ? "" : trimmed.slice(dot + 1);
  if (fractionPart.length > decimals) throw new Error(`Too many decimal places (max ${decimals}).`);
  return (
    BigInt(wholePart) * 10n ** BigInt(decimals) + BigInt(fractionPart.padEnd(decimals, "0") || "0")
  );
}

export type LiquidityPlanInput = {
  tokenAddress: string;
  wethAddress: string;
  /** Companion-token amount in 18-decimal base units. */
  tokenAmount: bigint;
  /** ETH amount in wei. */
  ethAmount: bigint;
  /** Fixed total supply of the token in base units. */
  totalSupply: bigint;
  slippageBps: number;
  tickSpacing: number;
};

export type LiquidityPlan = {
  token0: `0x${string}`;
  token1: `0x${string}`;
  tokenIsToken0: boolean;
  amount0Desired: bigint;
  amount1Desired: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
  sqrtPriceX96: bigint;
  tickLower: number;
  tickUpper: number;
  /** ETH per whole token, as a decimal string. */
  priceEthPerToken: string;
  /** Tokens per 1 ETH, as a decimal string. */
  tokensPerEth: string;
  /** Fully diluted valuation in ETH (price × total supply). */
  fdvEth: string;
};

/**
 * Derives every value the liquidity transactions need from the two amounts the seller chooses.
 * Uniswap defines price as token1 per token0, so the ratio is flipped depending on sort order.
 */
export function buildLiquidityPlan(input: LiquidityPlanInput): LiquidityPlan {
  if (input.tokenAmount <= 0n) throw new Error("Token amount must be greater than zero.");
  if (input.ethAmount <= 0n) throw new Error("ETH amount must be greater than zero.");
  if (input.totalSupply <= 0n) throw new Error("Total supply must be greater than zero.");
  if (input.tokenAmount > input.totalSupply)
    throw new Error("Token amount exceeds the fixed total supply.");

  const { token0, token1, flipped } = sortTokens(input.tokenAddress, input.wethAddress);
  const tokenIsToken0 = !flipped;
  const amount0Desired = tokenIsToken0 ? input.tokenAmount : input.ethAmount;
  const amount1Desired = tokenIsToken0 ? input.ethAmount : input.tokenAmount;
  const sqrtPriceX96 = encodeSqrtPriceX96(amount1Desired, amount0Desired);
  const { tickLower, tickUpper } = fullRangeTicks(input.tickSpacing);

  const scale = 10n ** 18n;
  const priceWeiPerToken = (input.ethAmount * scale) / input.tokenAmount;
  const tokensPerEthUnits = (input.tokenAmount * scale) / input.ethAmount;
  const fdvWei = (priceWeiPerToken * input.totalSupply) / scale;

  return {
    token0,
    token1,
    tokenIsToken0,
    amount0Desired,
    amount1Desired,
    amount0Min: applySlippage(amount0Desired, input.slippageBps),
    amount1Min: applySlippage(amount1Desired, input.slippageBps),
    sqrtPriceX96,
    tickLower,
    tickUpper,
    priceEthPerToken: formatFixed(priceWeiPerToken, 18),
    tokensPerEth: formatFixed(tokensPerEthUnits, 18, 6),
    fdvEth: formatFixed(fdvWei, 18, 6),
  };
}

/** Deviation between two sqrt prices, in basis points of the underlying price. */
export function priceDeviationBps(a: bigint, b: bigint): number {
  if (a <= 0n || b <= 0n) return Number.MAX_SAFE_INTEGER;
  const [lo, hi] = a < b ? [a, b] : [b, a];
  // price is proportional to sqrtPrice squared, so price deviation is about twice the sqrt deviation.
  return Number(((hi - lo) * 20_000n) / lo);
}

/**
 * Rejects a saved liquidity plan whose price reference has moved beyond the accepted slippage.
 * The seller must review the new live price and re-confirm before approvals or minting.
 */
export function requireFreshQuote(
  position: {
    acknowledged_pool_price_x96: string | null;
    sqrt_price_x96: string;
    slippage_bps: number;
  },
  livePriceX96: bigint,
) {
  const reference = BigInt(position.acknowledged_pool_price_x96 ?? position.sqrt_price_x96);
  if (priceDeviationBps(reference, livePriceX96) > position.slippage_bps) {
    throw new Error(
      `The live pool price (sqrtPriceX96 ${livePriceX96.toString()}) has moved beyond your ${(position.slippage_bps / 100).toFixed(2)}% ` +
        `tolerance from the price you confirmed (${reference.toString()}). This quote is void — reset the plan and confirm the new price.`,
    );
  }
}

/* ------------------------------------------------- TickMath / LiquidityAmounts */

const TICK_MULTIPLIERS: [bigint, bigint][] = [
  [0x2n, 0xfff97272373d413259a46990580e213an],
  [0x4n, 0xfff2e50f5f656932ef12357cf3c7fdccn],
  [0x8n, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
  [0x10n, 0xffcb9843d60f6159c9db58835c926644n],
  [0x20n, 0xff973b41fa98c081472e6896dfb254c0n],
  [0x40n, 0xff2ea16466c96a3843ec78b326b52861n],
  [0x80n, 0xfe5dee046a99a2a811c461f1969c3053n],
  [0x100n, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
  [0x200n, 0xf987a7253ac413176f2b074cf7815e54n],
  [0x400n, 0xf3392b0822b70005940c7a398e4b70f3n],
  [0x800n, 0xe7159475a2c29b7443b29c7fa6e889d9n],
  [0x1000n, 0xd097f3bdfd2022b8845ad8f792aa5825n],
  [0x2000n, 0xa9f746462d870fdf8a65dc1f90e061e5n],
  [0x4000n, 0x70d869a156d2a1b890bb3df62baf32f7n],
  [0x8000n, 0x31be135f97d08fd981231505542fcfa6n],
  [0x10000n, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
  [0x20000n, 0x5d6af8dedb81196699c329225ee604n],
  [0x40000n, 0x2216e584f5fa1ea926041bedfe98n],
  [0x80000n, 0x48a170391f7dc42444e8fa2n],
];

const UINT256_MAX = 2n ** 256n - 1n;

/** Uniswap v3 TickMath.getSqrtRatioAtTick, exact integer port. */
export function getSqrtRatioAtTick(tick: number): bigint {
  if (!Number.isInteger(tick) || Math.abs(tick) > MAX_TICK) throw new Error("Tick out of range.");
  const absTick = BigInt(Math.abs(tick));
  let ratio =
    (absTick & 0x1n) !== 0n
      ? 0xfffcb933bd6fad37aa2d162d1a594001n
      : 0x100000000000000000000000000000000n;
  for (const [bit, multiplier] of TICK_MULTIPLIERS) {
    if ((absTick & bit) !== 0n) ratio = (ratio * multiplier) >> 128n;
  }
  if (tick > 0) ratio = UINT256_MAX / ratio;
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n);
}

function ordered(a: bigint, b: bigint): [bigint, bigint] {
  return a <= b ? [a, b] : [b, a];
}

export function getLiquidityForAmount0(sqrtA: bigint, sqrtB: bigint, amount0: bigint): bigint {
  const [lo, hi] = ordered(sqrtA, sqrtB);
  if (hi === lo) return 0n;
  const intermediate = (lo * hi) / Q96;
  return (amount0 * intermediate) / (hi - lo);
}

export function getLiquidityForAmount1(sqrtA: bigint, sqrtB: bigint, amount1: bigint): bigint {
  const [lo, hi] = ordered(sqrtA, sqrtB);
  if (hi === lo) return 0n;
  return (amount1 * Q96) / (hi - lo);
}

/** Largest liquidity obtainable from the two maximum amounts at the live price. */
export function getLiquidityForAmounts(
  sqrtPriceX96: bigint,
  sqrtA: bigint,
  sqrtB: bigint,
  amount0: bigint,
  amount1: bigint,
): bigint {
  const [lo, hi] = ordered(sqrtA, sqrtB);
  if (sqrtPriceX96 <= lo) return getLiquidityForAmount0(lo, hi, amount0);
  if (sqrtPriceX96 < hi) {
    const l0 = getLiquidityForAmount0(sqrtPriceX96, hi, amount0);
    const l1 = getLiquidityForAmount1(lo, sqrtPriceX96, amount1);
    return l0 < l1 ? l0 : l1;
  }
  return getLiquidityForAmount1(lo, hi, amount1);
}

export function getAmount0ForLiquidity(sqrtA: bigint, sqrtB: bigint, liquidity: bigint): bigint {
  const [lo, hi] = ordered(sqrtA, sqrtB);
  if (lo === 0n) throw new Error("sqrt price must be positive.");
  return ((liquidity << 96n) * (hi - lo)) / hi / lo;
}

export function getAmount1ForLiquidity(sqrtA: bigint, sqrtB: bigint, liquidity: bigint): bigint {
  const [lo, hi] = ordered(sqrtA, sqrtB);
  return (liquidity * (hi - lo)) / Q96;
}

export function getAmountsForLiquidity(
  sqrtPriceX96: bigint,
  sqrtA: bigint,
  sqrtB: bigint,
  liquidity: bigint,
): { amount0: bigint; amount1: bigint } {
  const [lo, hi] = ordered(sqrtA, sqrtB);
  if (sqrtPriceX96 <= lo) {
    return { amount0: getAmount0ForLiquidity(lo, hi, liquidity), amount1: 0n };
  }
  if (sqrtPriceX96 < hi) {
    return {
      amount0: getAmount0ForLiquidity(sqrtPriceX96, hi, liquidity),
      amount1: getAmount1ForLiquidity(lo, sqrtPriceX96, liquidity),
    };
  }
  return { amount0: 0n, amount1: getAmount1ForLiquidity(lo, hi, liquidity) };
}

export type ExistingPoolQuote = {
  sqrtPriceX96: bigint;
  liquidity: bigint;
  /** What the position manager will actually pull in, at the live price. */
  amount0Used: bigint;
  amount1Used: bigint;
  /** What stays in the wallet because the live price does not match the requested ratio. */
  amount0Excess: bigint;
  amount1Excess: bigint;
  /** Slippage floors derived from the LIVE quote, never from the seller's opening ratio. */
  amount0Min: bigint;
  amount1Min: bigint;
};

/**
 * Quotes a deposit against a pool that already exists. The seller's amounts are maximums:
 * the live price decides how much of each side is consumed and how much comes back.
 */
export function quoteExistingPool(input: {
  sqrtPriceX96: bigint;
  tickLower: number;
  tickUpper: number;
  amount0Max: bigint;
  amount1Max: bigint;
  slippageBps: number;
}): ExistingPoolQuote {
  if (input.sqrtPriceX96 <= 0n) throw new Error("The pool price must be positive.");
  if (input.tickLower >= input.tickUpper) throw new Error("Invalid tick range.");
  const sqrtA = getSqrtRatioAtTick(input.tickLower);
  const sqrtB = getSqrtRatioAtTick(input.tickUpper);
  const liquidity = getLiquidityForAmounts(
    input.sqrtPriceX96,
    sqrtA,
    sqrtB,
    input.amount0Max,
    input.amount1Max,
  );
  if (liquidity <= 0n) {
    throw new Error(
      "At the current pool price these amounts produce no liquidity. Change the amounts.",
    );
  }
  const used = getAmountsForLiquidity(input.sqrtPriceX96, sqrtA, sqrtB, liquidity);
  const amount0Used = used.amount0 > input.amount0Max ? input.amount0Max : used.amount0;
  const amount1Used = used.amount1 > input.amount1Max ? input.amount1Max : used.amount1;
  return {
    sqrtPriceX96: input.sqrtPriceX96,
    liquidity,
    amount0Used,
    amount1Used,
    amount0Excess: input.amount0Max - amount0Used,
    amount1Excess: input.amount1Max - amount1Used,
    amount0Min: applySlippage(amount0Used, input.slippageBps),
    amount1Min: applySlippage(amount1Used, input.slippageBps),
  };
}
