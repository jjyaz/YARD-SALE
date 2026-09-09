import { describe, expect, it } from "vitest";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  MINT_VOUCHER_TYPES,
  nonceForPassport,
  signMintVoucher,
  signerStatus,
  VOUCHER_TTL_SECONDS,
} from "@/lib/passport-voucher.server";

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const ACCOUNT = privateKeyToAccount(KEY);
const REGISTRY = "0x1111111111111111111111111111111111111111" as const;
const OTHER_REGISTRY = "0x2222222222222222222222222222222222222222" as const;
const SELLER = "0x3333333333333333333333333333333333333333" as const;

function voucher(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    seller: SELLER,
    listingId: `0x${"11".repeat(32)}`,
    metadataURIHash: `0x${"22".repeat(32)}`,
    metadataHash: `0x${"33".repeat(32)}`,
    termsHash: `0x${"44".repeat(32)}`,
    nonce: 7n,
    expiry: 1_800_000_000n,
    ...overrides,
  } as never;
}

function domain(chainId: number, registry: string) {
  return {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId,
    verifyingContract: registry as `0x${string}`,
  };
}

describe("mint voucher signing", () => {
  it("reports the signing key as missing when it is not configured", () => {
    delete process.env["PLATFORM_SIGNER_PRIVATE_KEY"];
    expect(signerStatus()).toEqual({ configured: false, missing: "PLATFORM_SIGNER_PRIVATE_KEY" });
  });

  it("derives a stable per-passport nonce so retries reuse one voucher slot", () => {
    const a = nonceForPassport("2f6b7d6e-0f0a-4f6e-9a1a-1a1a1a1a1a1a");
    expect(nonceForPassport("2f6b7d6e-0f0a-4f6e-9a1a-1a1a1a1a1a1a")).toBe(a);
    expect(nonceForPassport("11111111-0f0a-4f6e-9a1a-1a1a1a1a1a1a")).not.toBe(a);
  });

  it("keeps vouchers short-lived", () => {
    expect(VOUCHER_TTL_SECONDS).toBeLessThanOrEqual(60 * 60);
  });

  it("produces a signature recoverable to the platform signer", async () => {
    process.env["PLATFORM_SIGNER_PRIVATE_KEY"] = KEY;
    const { signature, signer } = await signMintVoucher({
      chainId: 4663,
      registry: REGISTRY,
      voucher: voucher(),
    });
    expect(signer).toBe(ACCOUNT.address);
    const recovered = await recoverTypedDataAddress({
      domain: domain(4663, REGISTRY),
      types: MINT_VOUCHER_TYPES,
      primaryType: "MintVoucher",
      message: voucher(),
      signature,
    });
    expect(recovered).toBe(ACCOUNT.address);
  });

  it("ADVERSARIAL: a signature does not verify against another chain or another registry", async () => {
    process.env["PLATFORM_SIGNER_PRIVATE_KEY"] = KEY;
    const { signature } = await signMintVoucher({
      chainId: 4663,
      registry: REGISTRY,
      voucher: voucher(),
    });
    const wrongChain = await recoverTypedDataAddress({
      domain: domain(46630, REGISTRY),
      types: MINT_VOUCHER_TYPES,
      primaryType: "MintVoucher",
      message: voucher(),
      signature,
    });
    const wrongRegistry = await recoverTypedDataAddress({
      domain: domain(4663, OTHER_REGISTRY),
      types: MINT_VOUCHER_TYPES,
      primaryType: "MintVoucher",
      message: voucher(),
      signature,
    });
    expect(wrongChain).not.toBe(ACCOUNT.address);
    expect(wrongRegistry).not.toBe(ACCOUNT.address);
  });

  it("ADVERSARIAL: a voucher signed for one seller does not authorise another", async () => {
    process.env["PLATFORM_SIGNER_PRIVATE_KEY"] = KEY;
    const { signature } = await signMintVoucher({
      chainId: 4663,
      registry: REGISTRY,
      voucher: voucher(),
    });
    const recovered = await recoverTypedDataAddress({
      domain: domain(4663, REGISTRY),
      types: MINT_VOUCHER_TYPES,
      primaryType: "MintVoucher",
      message: voucher({ seller: "0x4444444444444444444444444444444444444444" }),
      signature,
    });
    expect(recovered).not.toBe(ACCOUNT.address);
  });
});
