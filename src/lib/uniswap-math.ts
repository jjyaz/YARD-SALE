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

/** Floor square root for arbitrary-size bigints (Newton's method). */
export function sqrtBigInt(value: bigint): bigint {
  if (value < 0n) throw new Error("Cannot take the square root of a negative number.");
  if (value < 2n) return value;
  let x0 = value;
  let x1 = (value >> 1n) + 1n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x1 + value / x1) >> 1n;
  }
  return x0;
}

/** Uniswap sorts pools by token address (lowercase hex compares like uint160). */
export function sortTokens(a: string, b: string): { token0: `0x${string}`; token1: `0x${string}`; flipped: boolean } {
  const la = a.toLowerCase() as `0x${string}`;
  const lb = b.toLowerCase() as `0x${string}`;
  if (la === lb) throw new Error("Both tokens are the same address.");
  return BigInt(la) < BigInt(lb) ? { token0: la, token1: lb, flipped: false } : { token0: lb, token1: la, flipped: true };
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
    throw new Error("The opening ratio is outside the range Uniswap v3 can represent. Change the amounts.");
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
  return BigInt(wholePart) * 10n ** BigInt(decimals) + BigInt(fractionPart.padEnd(decimals, "0") || "0");
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
  if (input.tokenAmount > input.totalSupply) throw new Error("Token amount exceeds the fixed total supply.");

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
