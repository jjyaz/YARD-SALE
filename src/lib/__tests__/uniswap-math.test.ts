import { describe, expect, it } from "vitest";

import {
  MAX_SQRT_RATIO,
  MIN_SQRT_RATIO,
  Q96,
  applySlippage,
  buildLiquidityPlan,
  priceDeviationBps,
  requireFreshQuote,
  encodeSqrtPriceX96,
  formatFixed,
  fullRangeTicks,
  getAmountsForLiquidity,
  getSqrtRatioAtTick,
  quoteExistingPool,
  parseFixed,
  priceFromSqrtPriceX96,
  sortTokens,
  sqrtBigInt,
} from "@/lib/uniswap-math";

const WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73"; // canonical Robinhood Chain WETH
const LOW_TOKEN = "0x0000000000000000000000000000000000000001";
const HIGH_TOKEN = "0xffffffffffffffffffffffffffffffffffffffff";

describe("sqrtBigInt", () => {
  it("returns exact roots for perfect squares", () => {
    expect(sqrtBigInt(0n)).toBe(0n);
    expect(sqrtBigInt(1n)).toBe(1n);
    expect(sqrtBigInt(144n)).toBe(12n);
    expect(sqrtBigInt(2n ** 192n)).toBe(2n ** 96n);
  });

  it("floors non-perfect squares", () => {
    expect(sqrtBigInt(2n)).toBe(1n);
    expect(sqrtBigInt(99n)).toBe(9n);
    const big = 10n ** 40n + 12345n;
    const root = sqrtBigInt(big);
    expect(root * root <= big).toBe(true);
    expect((root + 1n) * (root + 1n) > big).toBe(true);
  });

  it("rejects negatives", () => {
    expect(() => sqrtBigInt(-1n)).toThrow();
  });
});

describe("sortTokens", () => {
  it("orders by numeric address value like Uniswap", () => {
    const a = sortTokens(HIGH_TOKEN, LOW_TOKEN);
    expect(a.token0).toBe(LOW_TOKEN);
    expect(a.token1).toBe(HIGH_TOKEN);
    expect(a.flipped).toBe(true);
    const b = sortTokens(LOW_TOKEN, HIGH_TOKEN);
    expect(b.flipped).toBe(false);
  });

  it("is case-insensitive and rejects identical tokens", () => {
    expect(sortTokens(WETH.toUpperCase().replace("0X", "0x"), LOW_TOKEN).token1).toBe(WETH);
    expect(() => sortTokens(WETH, WETH)).toThrow();
  });
});

describe("encodeSqrtPriceX96", () => {
  it("encodes a 1:1 price as exactly 2^96", () => {
    expect(encodeSqrtPriceX96(10n ** 18n, 10n ** 18n)).toBe(Q96);
  });

  it("encodes a 4:1 price as 2 * 2^96", () => {
    expect(encodeSqrtPriceX96(4n * 10n ** 18n, 10n ** 18n)).toBe(2n * Q96);
  });

  it("matches the Uniswap reference (1 ETH : 1,000,000 tokens)", () => {
    // sqrt(1e18 / 1e24) * 2^96 = 1e-3 * 2^96 = 79228162514264337593543950 (floored)
    expect(encodeSqrtPriceX96(10n ** 18n, 10n ** 24n)).toBe(79228162514264337593543950n);
  });

  it("stays within the TickMath bounds or throws", () => {
    const ok = encodeSqrtPriceX96(1n, 10n ** 30n);
    expect(ok >= MIN_SQRT_RATIO && ok < MAX_SQRT_RATIO).toBe(true);
    expect(() => encodeSqrtPriceX96(1n, 10n ** 60n)).toThrow(/outside the range/);
    expect(() => encodeSqrtPriceX96(10n ** 60n, 1n)).toThrow(/outside the range/);
    expect(() => encodeSqrtPriceX96(0n, 1n)).toThrow();
  });
});

describe("priceFromSqrtPriceX96", () => {
  it("round-trips simple prices", () => {
    expect(priceFromSqrtPriceX96(Q96)).toBe("1");
    expect(priceFromSqrtPriceX96(2n * Q96)).toBe("4");
    expect(priceFromSqrtPriceX96(encodeSqrtPriceX96(10n ** 18n, 4n * 10n ** 18n))).toBe("0.25");
  });
});

describe("fullRangeTicks", () => {
  it("uses the widest ticks divisible by the spacing (0.3% tier = 60)", () => {
    expect(fullRangeTicks(60)).toEqual({ tickLower: -887220, tickUpper: 887220 });
    expect(fullRangeTicks(10)).toEqual({ tickLower: -887270, tickUpper: 887270 });
    expect(fullRangeTicks(1)).toEqual({ tickLower: -887272, tickUpper: 887272 });
  });

  it("rejects invalid spacing", () => {
    expect(() => fullRangeTicks(0)).toThrow();
    expect(() => fullRangeTicks(1.5)).toThrow();
  });
});

describe("applySlippage", () => {
  it("reduces by basis points with integer math", () => {
    expect(applySlippage(10_000n, 100)).toBe(9_900n);
    expect(applySlippage(10_000n, 0)).toBe(10_000n);
    expect(applySlippage(333n, 50)).toBe(331n); // floor
  });

  it("rejects out-of-range values", () => {
    expect(() => applySlippage(1n, -1)).toThrow();
    expect(() => applySlippage(1n, 10_001)).toThrow();
  });
});

describe("formatFixed / parseFixed", () => {
  it("round-trips decimals exactly", () => {
    expect(parseFixed("1.5")).toBe(15n * 10n ** 17n);
    expect(parseFixed("0.000000000000000001")).toBe(1n);
    expect(formatFixed(parseFixed("123.456"))).toBe("123.456");
    expect(formatFixed(10n ** 18n)).toBe("1");
    expect(formatFixed(0n)).toBe("0");
  });

  it("limits fraction digits when asked", () => {
    expect(formatFixed(parseFixed("1.23456789"), 18, 4)).toBe("1.2345");
  });

  it("rejects junk, negatives and too many decimals", () => {
    expect(() => parseFixed("abc")).toThrow();
    expect(() => parseFixed("-1")).toThrow();
    expect(() => parseFixed("1e18")).toThrow();
    expect(() => parseFixed("1.0000000000000000001")).toThrow(/decimal places/);
  });
});

describe("buildLiquidityPlan", () => {
  const supply = 1_000_000n * 10n ** 18n;

  it("computes price, FDV, minimums and sort order when the token is token0", () => {
    const plan = buildLiquidityPlan({
      tokenAddress: LOW_TOKEN,
      wethAddress: WETH,
      tokenAmount: 500_000n * 10n ** 18n,
      ethAmount: 5n * 10n ** 17n, // 0.5 ETH
      totalSupply: supply,
      slippageBps: 100,
      tickSpacing: 60,
    });
    expect(plan.tokenIsToken0).toBe(true);
    expect(plan.token0).toBe(LOW_TOKEN);
    expect(plan.token1).toBe(WETH);
    expect(plan.amount0Desired).toBe(500_000n * 10n ** 18n);
    expect(plan.amount1Desired).toBe(5n * 10n ** 17n);
    expect(plan.amount0Min).toBe(495_000n * 10n ** 18n);
    expect(plan.amount1Min).toBe(495n * 10n ** 15n);
    expect(plan.priceEthPerToken).toBe("0.000001");
    expect(plan.tokensPerEth).toBe("1000000");
    expect(plan.fdvEth).toBe("1");
    expect(plan.tickLower).toBe(-887220);
    expect(plan.tickUpper).toBe(887220);
    // price = token1/token0 = 0.5e18 / 5e23 = 1e-6
    expect(priceFromSqrtPriceX96(plan.sqrtPriceX96, 18).startsWith("0.000000999999")).toBe(true);
  });

  it("flips amounts when WETH sorts first", () => {
    const plan = buildLiquidityPlan({
      tokenAddress: HIGH_TOKEN,
      wethAddress: WETH,
      tokenAmount: 1_000n * 10n ** 18n,
      ethAmount: 10n ** 18n,
      totalSupply: supply,
      slippageBps: 50,
      tickSpacing: 60,
    });
    expect(plan.tokenIsToken0).toBe(false);
    expect(plan.token0).toBe(WETH);
    expect(plan.amount0Desired).toBe(10n ** 18n);
    expect(plan.amount1Desired).toBe(1_000n * 10n ** 18n);
    // price token1/token0 = tokens per ETH = 1000 (sqrt is floored, so allow a sub-ppb rounding error)
    const decoded = Number(priceFromSqrtPriceX96(plan.sqrtPriceX96, 18));
    expect(Math.abs(decoded - 1000) / 1000).toBeLessThan(1e-9);
    expect(plan.priceEthPerToken).toBe("0.001");
  });

  it("refuses zero amounts and more tokens than exist", () => {
    const base = {
      tokenAddress: LOW_TOKEN,
      wethAddress: WETH,
      totalSupply: supply,
      slippageBps: 100,
      tickSpacing: 60,
    };
    expect(() => buildLiquidityPlan({ ...base, tokenAmount: 0n, ethAmount: 1n })).toThrow();
    expect(() => buildLiquidityPlan({ ...base, tokenAmount: 1n, ethAmount: 0n })).toThrow();
    expect(() => buildLiquidityPlan({ ...base, tokenAmount: supply + 1n, ethAmount: 1n })).toThrow(
      /exceeds/,
    );
  });
});

describe("stale liquidity quotes", () => {
  const base = 79228162514264337593543950336n; // sqrtPriceX96 for price 1

  it("reports no deviation for an identical price", () => {
    expect(priceDeviationBps(base, base)).toBe(0);
  });

  it("reports roughly double the sqrt deviation as price deviation", () => {
    const moved = (base * 101n) / 100n; // +1% sqrt => ~2% price
    expect(priceDeviationBps(base, moved)).toBeGreaterThanOrEqual(199);
    expect(priceDeviationBps(base, moved)).toBeLessThanOrEqual(201);
  });

  it("accepts a plan whose confirmed price is still within tolerance", () => {
    expect(() =>
      requireFreshQuote(
        {
          acknowledged_pool_price_x96: base.toString(),
          sqrt_price_x96: base.toString(),
          slippage_bps: 300,
        },
        (base * 1001n) / 1000n,
      ),
    ).not.toThrow();
  });

  it("voids a plan whose confirmed price moved beyond tolerance", () => {
    expect(() =>
      requireFreshQuote(
        {
          acknowledged_pool_price_x96: base.toString(),
          sqrt_price_x96: base.toString(),
          slippage_bps: 50,
        },
        (base * 12n) / 10n,
      ),
    ).toThrow(/quote is void/);
  });

  it("falls back to the planned opening price when no pool price was confirmed", () => {
    expect(() =>
      requireFreshQuote(
        { acknowledged_pool_price_x96: null, sqrt_price_x96: base.toString(), slippage_bps: 100 },
        base * 3n,
      ),
    ).toThrow(/moved beyond/);
  });
});

describe("exact tick math", () => {
  it("matches Uniswap's known sqrt ratios", () => {
    expect(getSqrtRatioAtTick(0)).toBe(79228162514264337593543950336n);
    // MIN_TICK / MAX_TICK boundaries from Uniswap v3 TickMath.
    expect(getSqrtRatioAtTick(-887272)).toBe(4295128739n);
    expect(getSqrtRatioAtTick(887272)).toBe(1461446703485210103287273052203988822378723970342n);
  });

  it("is monotonic in the tick", () => {
    expect(getSqrtRatioAtTick(60)).toBeGreaterThan(getSqrtRatioAtTick(0));
    expect(getSqrtRatioAtTick(-60)).toBeLessThan(getSqrtRatioAtTick(0));
  });

  it("rejects out-of-range ticks", () => {
    expect(() => getSqrtRatioAtTick(900000)).toThrow();
  });
});

describe("quoteExistingPool", () => {
  const range = { tickLower: -887220, tickUpper: 887220 };

  it("consumes both sides at a mid-range price and leaves excess on the heavy side", () => {
    const quote = quoteExistingPool({
      sqrtPriceX96: getSqrtRatioAtTick(0),
      ...range,
      amount0Max: 1000n * 10n ** 18n,
      amount1Max: 1n * 10n ** 18n,
      slippageBps: 100,
    });
    expect(quote.liquidity).toBeGreaterThan(0n);
    expect(quote.amount0Used).toBeGreaterThan(0n);
    expect(quote.amount1Used).toBeGreaterThan(0n);
    // At a 1:1 price the 1000-token side cannot be fully used against 1 ETH.
    expect(quote.amount0Excess).toBeGreaterThan(0n);
    expect(quote.amount0Used + quote.amount0Excess).toBe(1000n * 10n ** 18n);
    expect(quote.amount1Used + quote.amount1Excess).toBe(1n * 10n ** 18n);
  });

  it("derives minimums from the live quote, never from the requested amounts", () => {
    const amount0Max = 500n * 10n ** 18n;
    const amount1Max = 2n * 10n ** 18n;
    const quote = quoteExistingPool({
      sqrtPriceX96: getSqrtRatioAtTick(6000),
      ...range,
      amount0Max,
      amount1Max,
      slippageBps: 50,
    });
    expect(quote.amount0Min).toBeLessThanOrEqual(quote.amount0Used);
    expect(quote.amount1Min).toBeLessThanOrEqual(quote.amount1Used);
    expect(quote.amount0Min).toBeLessThan(amount0Max);
    expect(quote.amount1Min).toBeLessThan(amount1Max);
  });

  it("produces a different quote when the pool price moves", () => {
    const base = {
      ...range,
      amount0Max: 1000n * 10n ** 18n,
      amount1Max: 1n * 10n ** 18n,
      slippageBps: 100,
    };
    const before = quoteExistingPool({ sqrtPriceX96: getSqrtRatioAtTick(0), ...base });
    const after = quoteExistingPool({ sqrtPriceX96: getSqrtRatioAtTick(20000), ...base });
    expect(after.amount0Used).not.toBe(before.amount0Used);
    expect(after.amount0Min).not.toBe(before.amount0Min);
  });

  it("refuses a price or range that yields no liquidity", () => {
    expect(() =>
      quoteExistingPool({
        sqrtPriceX96: 0n,
        ...range,
        amount0Max: 1n,
        amount1Max: 1n,
        slippageBps: 100,
      }),
    ).toThrow(/positive/);
    expect(() =>
      quoteExistingPool({
        sqrtPriceX96: getSqrtRatioAtTick(0),
        tickLower: 600,
        tickUpper: 60,
        amount0Max: 1n,
        amount1Max: 1n,
        slippageBps: 100,
      }),
    ).toThrow(/range/);
  });

  it("round-trips liquidity back into the amounts it represents", () => {
    const sqrtPriceX96 = getSqrtRatioAtTick(1200);
    const quote = quoteExistingPool({
      sqrtPriceX96,
      ...range,
      amount0Max: 10n ** 21n,
      amount1Max: 10n ** 18n,
      slippageBps: 0,
    });
    const amounts = getAmountsForLiquidity(
      sqrtPriceX96,
      getSqrtRatioAtTick(range.tickLower),
      getSqrtRatioAtTick(range.tickUpper),
      quote.liquidity,
    );
    expect(amounts.amount0).toBe(quote.amount0Used);
    expect(amounts.amount1).toBe(quote.amount1Used);
  });
});
