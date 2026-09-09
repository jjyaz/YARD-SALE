import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { canonicalJson, buildPassportMetadata } from "@/lib/passport-metadata";
import { cidV1Raw } from "@/lib/ipfs";
import {
  assertOnlyIpfsImages,
  liveVoucherBlock,
  pinListingImages,
  type PinOutcome,
} from "@/lib/passport-freeze";

const sha256 = (bytes: Uint8Array) => `0x${createHash("sha256").update(bytes).digest("hex")}`;

/** A stand-in for storage + a pinning service, so the whole freeze path is exercised for real. */
function makeWorld(files: Record<string, Uint8Array>) {
  const storage = new Map(Object.entries(files));
  const ipfs = new Map<string, Uint8Array>();
  return {
    storage,
    ipfs,
    deps: {
      download: async (path: string) => {
        const bytes = storage.get(path);
        return bytes ? { bytes, contentType: "image/jpeg" } : null;
      },
      pin: async (bytes: Uint8Array): Promise<PinOutcome> => {
        const cid = await cidV1Raw(bytes);
        // A real pinner keeps the exact bytes under that content ID, forever.
        ipfs.set(cid, Uint8Array.from(bytes));
        return { pinned: true, cid, verifiedBy: "cid" };
      },
      sha256,
      localCid: cidV1Raw,
    },
  };
}

const bytesOf = (text: string) => new TextEncoder().encode(text);

describe("pinListingImages", () => {
  const media = [{ storage_path: "u/1/a.jpg" }, { storage_path: "u/1/b.jpg" }];

  it("pins every image individually and returns only ipfs:// URIs", async () => {
    const world = makeWorld({
      "u/1/a.jpg": bytesOf("original photo A"),
      "u/1/b.jpg": bytesOf("original photo B"),
    });
    const { images, records } = await pinListingImages({ media, ...world.deps });

    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(image.url.startsWith("ipfs://")).toBe(true);
      expect(image.url).toBe(`ipfs://${image.cid}`);
      expect(image.sha256).toMatch(/^0x[0-9a-f]{64}$/);
    }
    expect(new Set(images.map((i) => i.cid)).size).toBe(2);
    expect(records.map((r) => r.storage_path)).toEqual(["u/1/a.jpg", "u/1/b.jpg"]);
    // Each CID really addresses the bytes that were read.
    for (const record of records) {
      expect(sha256(world.ipfs.get(record.cid)!)).toBe(record.sha256);
    }
  });

  it("keeps the frozen image byte-identical after the storage file is REPLACED", async () => {
    const world = makeWorld({ "u/1/a.jpg": bytesOf("original photo A") });
    const frozen = await pinListingImages({ media: [media[0]!], ...world.deps });
    const record = frozen.records[0]!;

    // Someone swaps the underlying upload for different content.
    world.storage.set("u/1/a.jpg", bytesOf("SWAPPED photo — damage hidden"));

    const served = world.ipfs.get(record.cid)!;
    expect(new TextDecoder().decode(served)).toBe("original photo A");
    expect(sha256(served)).toBe(record.sha256);
    expect(await cidV1Raw(served)).toBe(record.cid);
    // Re-freezing the swapped file produces a different content ID; the old one is untouched.
    const refrozen = await pinListingImages({ media: [media[0]!], ...world.deps });
    expect(refrozen.records[0]!.cid).not.toBe(record.cid);
    expect(sha256(world.ipfs.get(record.cid)!)).toBe(record.sha256);
  });

  it("keeps the frozen image retrievable after the storage file is DELETED", async () => {
    const world = makeWorld({ "u/1/a.jpg": bytesOf("original photo A") });
    const frozen = await pinListingImages({ media: [media[0]!], ...world.deps });
    const record = frozen.records[0]!;

    world.storage.delete("u/1/a.jpg");

    const served = world.ipfs.get(record.cid);
    expect(served).toBeDefined();
    expect(sha256(served!)).toBe(record.sha256);
    // And the source really is gone, so this proves the pin is what survives.
    await expect(pinListingImages({ media: [media[0]!], ...world.deps })).rejects.toThrow(
      /could not be read from storage/,
    );
  });

  it("still resolves the frozen JSON to the original image after storage changes", async () => {
    const world = makeWorld({ "u/1/a.jpg": bytesOf("original photo A") });
    const { images, records } = await pinListingImages({ media: [media[0]!], ...world.deps });
    const metadata = buildPassportMetadata({
      listingId: "11111111-1111-1111-1111-111111111111",
      slug: "teak-side-table",
      title: "Teak side table",
      description: "Solid teak, one owner.",
      category: "furniture",
      condition: "good",
      conditionNotes: null,
      brand: null,
      model: null,
      year: null,
      dimensions: null,
      city: "Leeds",
      region: "England",
      priceEth: "0.02",
      isFree: false,
      termsVersion: "2026-01",
      termsHash: "0xabc",
      sellerHandle: "yardie",
      images,
      frozenAt: "2026-01-01T00:00:00.000Z",
      chainId: 4663,
      registry: "0x0000000000000000000000000000000000000001",
      attestation: {
        possession: true,
        rightToSell: true,
        accurate: true,
        notProhibited: true,
        understandsNoRights: true,
      },
      attestedAt: "2026-01-01T00:00:00.000Z",
    });
    const canonical = canonicalJson(metadata);

    world.storage.set("u/1/a.jpg", bytesOf("SWAPPED"));
    world.storage.delete("u/1/a.jpg");

    expect(canonical).not.toContain("supabase");
    expect(canonical).not.toContain("http");
    expect(canonical).not.toContain("u/1/a.jpg");
    const cid = records[0]!.cid;
    expect(canonical).toContain(`ipfs://${cid}`);
    expect(sha256(world.ipfs.get(cid)!)).toBe(records[0]!.sha256);
  });

  it("refuses to freeze when a photo cannot be pinned", async () => {
    const world = makeWorld({ "u/1/a.jpg": bytesOf("A") });
    await expect(
      pinListingImages({
        media: [media[0]!],
        ...world.deps,
        pin: async () => ({ pinned: false, cid: null, missing: "PINATA_JWT" }),
      }),
    ).rejects.toThrow(/PINATA_JWT/);
  });

  it("refuses a content ID that does not address the bytes that were read", async () => {
    const world = makeWorld({ "u/1/a.jpg": bytesOf("A") });
    await expect(
      pinListingImages({
        media: [media[0]!],
        ...world.deps,
        pin: async () => ({ pinned: true, cid: "bafkreiliar", verifiedBy: "cid" }),
      }),
    ).rejects.toThrow(/but those bytes hash to/);
  });

  it("refuses a listing with no readable photos", async () => {
    const world = makeWorld({});
    await expect(pinListingImages({ media: [], ...world.deps })).rejects.toThrow(/No readable/);
  });
});

describe("assertOnlyIpfsImages", () => {
  it("accepts content-addressed images", () => {
    expect(() =>
      assertOnlyIpfsImages({ image: "ipfs://bafk1", images: [{ url: "ipfs://bafk1" }] }),
    ).not.toThrow();
  });

  it("rejects a Supabase URL or storage path that slipped through", () => {
    expect(() =>
      assertOnlyIpfsImages({
        image: "https://project.supabase.co/storage/v1/object/sign/listing-public/u/1/a.jpg",
        images: [{ url: "ipfs://bafk1" }],
      }),
    ).toThrow(/content-addressed/);
    expect(() => assertOnlyIpfsImages({ image: "ipfs://bafk1", images: [{ url: "u/1/a.jpg" }] })).toThrow(
      /content-addressed/,
    );
  });
});

describe("liveVoucherBlock", () => {
  const now = Date.parse("2026-01-01T12:00:00.000Z");

  it("does not block when no voucher was ever issued", () => {
    expect(liveVoucherBlock(null, now).blocked).toBe(false);
    expect(liveVoucherBlock({ voucher_expires_at: null }, now).blocked).toBe(false);
  });

  it("blocks while an issued voucher is still valid", () => {
    const block = liveVoucherBlock({ voucher_expires_at: "2026-01-01T12:30:00.000Z" }, now);
    expect(block.blocked).toBe(true);
    expect(block.expiresAt).toBe("2026-01-01T12:30:00.000Z");
  });

  it("stops blocking once the voucher has expired", () => {
    expect(liveVoucherBlock({ voucher_expires_at: "2026-01-01T11:59:59.000Z" }, now).blocked).toBe(
      false,
    );
  });
});
