import { describe, expect, it } from "vitest";
import { keccak256, toBytes } from "viem";

import {
  buildPassportMetadata,
  canonicalJson,
  COMPANION_TOKEN_DISCLAIMER,
  passportEligibility,
  toTokenUnits,
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
