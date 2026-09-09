import { describe, expect, it } from "vitest";
import { keccak256, toBytes } from "viem";

import {
  ATTESTATION_STATEMENTS,
  attestationComplete,
  buildPassportMetadata,
  canonicalJson,
  COMPANION_MAX_SUPPLY,
  COMPANION_TOKEN_DISCLAIMER,
  fromTokenUnits,
  LIQUIDITY_RISK_STATEMENTS,
  passportEligibility,
  toTokenUnits,
  validateTokenParams,
} from "@/lib/passport-metadata";

const base = {
  listingId: "11111111-1111-1111-1111-111111111111",
  slug: "teak-desk",
  title: "Teak desk",
  description: "A desk.",
  category: "furniture",
  condition: "good",
  conditionNotes: null,
  brand: null,
  model: null,
  year: null,
  dimensions: null,
  city: "Leeds",
  region: "England",
  priceEth: "0.05",
  isFree: false,
  termsVersion: "2026-01",
  sellerHandle: "oak_lane",
  images: [{ url: "https://cdn/a.jpg", sha256: "0xaa" }],
  frozenAt: "2026-09-08T00:00:00.000Z",
  termsHash: "0x473d0eeaaf7b4ec251c2bf167e865d0e5e1c9d15574572e2cd93c62367efb8a3",
  chainId: 46630,
  registry: "0x1111111111111111111111111111111111111111",
  attestation: { possession: true, rightToSell: true, accurate: true, notProhibited: true, understandsNoRights: true },
  attestedAt: "2026-09-08T00:00:00.000Z",
};

describe("canonicalJson", () => {
  it("is key-order independent", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it("keeps array order significant", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it("drops undefined values", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe("buildPassportMetadata", () => {
  it("produces a stable hash for identical input", () => {
    const a = keccak256(toBytes(canonicalJson(buildPassportMetadata(base))));
    const b = keccak256(toBytes(canonicalJson(buildPassportMetadata({ ...base }))));
    expect(a).toBe(b);
  });

  it("changes the hash when the listing changes", () => {
    const a = keccak256(toBytes(canonicalJson(buildPassportMetadata(base))));
    const b = keccak256(toBytes(canonicalJson(buildPassportMetadata({ ...base, title: "Oak desk" }))));
    expect(a).not.toBe(b);
  });

  it("changes the hash when a photo changes", () => {
    const a = keccak256(toBytes(canonicalJson(buildPassportMetadata(base))));
    const b = keccak256(
      toBytes(canonicalJson(buildPassportMetadata({ ...base, images: [{ url: "https://cdn/a.jpg", sha256: "0xbb" }] }))),
    );
    expect(a).not.toBe(b);
  });

  it("carries the no-rights language", () => {
    expect(buildPassportMetadata(base).disclaimer).toContain("not title to the physical item");
    expect(COMPANION_TOKEN_DISCLAIMER).toContain("no ownership");
  });

  it("omits empty attributes", () => {
    const attributes = buildPassportMetadata(base).attributes.map((a) => a.trait_type);
    expect(attributes).not.toContain("Brand");
    expect(attributes).toContain("Category");
  });
});

describe("passportEligibility", () => {
  const ok = { status: "published", is_demo: false, terms_version: "2026-01", mediaCount: 2, hasConfirmedPassport: false };

  it("accepts a complete published listing", () => {
    expect(passportEligibility(ok)).toEqual({ eligible: true, reason: "ok" });
  });

  it("rejects drafts, demos, photoless and un-termed listings", () => {
    expect(passportEligibility({ ...ok, status: "draft" }).reason).toBe("not_published");
    expect(passportEligibility({ ...ok, is_demo: true }).reason).toBe("demo_listing");
    expect(passportEligibility({ ...ok, mediaCount: 0 }).reason).toBe("no_photos");
    expect(passportEligibility({ ...ok, terms_version: null }).reason).toBe("no_terms");
  });

  it("never re-mints a confirmed passport", () => {
    expect(passportEligibility({ ...ok, hasConfirmedPassport: true })).toEqual({
      eligible: false,
      reason: "already_minted",
    });
  });
});

describe("toTokenUnits", () => {
  it("scales whole tokens to 18 decimals", () => {
    expect(toTokenUnits("1000000")).toBe(1000000n * 10n ** 18n);
  });

  it("rejects decimals and junk", () => {
    expect(() => toTokenUnits("1.5")).toThrow();
    expect(() => toTokenUnits("-1")).toThrow();
    expect(() => toTokenUnits("abc")).toThrow();
  });
});

describe("fromTokenUnits", () => {
  it("formats whole and fractional balances", () => {
    expect(fromTokenUnits(1000000n * 10n ** 18n)).toBe("1000000");
    expect(fromTokenUnits("1500000000000000000")).toBe("1.5");
    expect(fromTokenUnits(0)).toBe("0");
  });
});

describe("possession attestation", () => {
  const full = { possession: true, rightToSell: true, accurate: true, notProhibited: true, understandsNoRights: true };

  it("requires every statement to be explicitly accepted", () => {
    expect(ATTESTATION_STATEMENTS).toHaveLength(5);
    expect(attestationComplete(full)).toBe(true);
    for (const { key } of ATTESTATION_STATEMENTS) {
      expect(attestationComplete({ ...full, [key]: false })).toBe(false);
    }
    const { possession: _omitted, ...missingOne } = full;
    expect(attestationComplete(missingOne)).toBe(false);
    expect(attestationComplete(null)).toBe(false);
    expect(attestationComplete(undefined)).toBe(false);
  });

  it("spells out that a passport is not title and not a financial instrument", () => {
    const text = ATTESTATION_STATEMENTS.map((s) => s.text).join(" ");
    expect(text).toMatch(/not title/i);
    expect(text).toMatch(/not a financial instrument/i);
  });
});

describe("liquidity risk statements", () => {
  it("cover pricing, loss, appraisal, permissionless trading and no lock", () => {
    const text = LIQUIDITY_RISK_STATEMENTS.join(" ").toLowerCase();
    expect(LIQUIDITY_RISK_STATEMENTS.length).toBeGreaterThanOrEqual(5);
    expect(text).toContain("opening");
    expect(text).toContain("zero");
    expect(text).toContain("appraisal");
    expect(text).toContain("lock");
  });
});

describe("validateTokenParams", () => {
  const ok = { name: "Teak Desk Token", symbol: "TEAK", totalSupply: toTokenUnits("1000000"), creatorAllocation: toTokenUnits("1000000") };

  it("accepts a valid fixed-supply configuration", () => {
    expect(validateTokenParams(ok)).toBeNull();
    expect(validateTokenParams({ ...ok, creatorAllocation: toTokenUnits("1") })).toBeNull();
  });

  it("mirrors the on-chain MAX_SUPPLY", () => {
    expect(COMPANION_MAX_SUPPLY).toBe(10n ** 12n * 10n ** 18n);
    expect(validateTokenParams({ ...ok, totalSupply: COMPANION_MAX_SUPPLY, creatorAllocation: COMPANION_MAX_SUPPLY })).toBeNull();
    expect(validateTokenParams({ ...ok, totalSupply: COMPANION_MAX_SUPPLY + 1n })).toMatch(/exceeds the contract maximum/);
  });

  it("rejects empty names/symbols, zero supply and over-allocation", () => {
    expect(validateTokenParams({ ...ok, name: "  " })).toMatch(/name is required/);
    expect(validateTokenParams({ ...ok, name: "x".repeat(65) })).toMatch(/64 characters/);
    expect(validateTokenParams({ ...ok, symbol: "" })).toMatch(/symbol is required/);
    expect(validateTokenParams({ ...ok, symbol: "TOOLONGSYMBOL12345" })).toMatch(/16 characters/);
    expect(validateTokenParams({ ...ok, totalSupply: 0n })).toMatch(/greater than zero/);
    expect(validateTokenParams({ ...ok, creatorAllocation: 0n })).toMatch(/allocation must be greater/);
    expect(validateTokenParams({ ...ok, creatorAllocation: ok.totalSupply + 1n })).toMatch(/cannot exceed/);
  });
});
