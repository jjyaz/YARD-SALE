/**
 * EIP-712 mint-voucher signing. Server-only (blocked from client bundles by filename).
 *
 * The registry accepts a passport mint only when it carries a voucher signed by an address
 * holding SIGNER_ROLE. That closes the listing-key front-running hole: knowing another
 * seller's public listing UUID is useless without a platform signature bound to that seller.
 *
 * The signing key lives in the PLATFORM_SIGNER_PRIVATE_KEY backend secret. It is never sent
 * to the browser, never logged, and never written to the database.
 */
import { keccak256, toBytes, type Address } from "viem";

export const MINT_VOUCHER_TYPES = {
  MintVoucher: [
    { name: "seller", type: "address" },
    { name: "listingId", type: "bytes32" },
    { name: "metadataURIHash", type: "bytes32" },
    { name: "metadataHash", type: "bytes32" },
    { name: "termsHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
} as const;

export const EIP712_DOMAIN_NAME = "YARD SALE Item Passport";
export const EIP712_DOMAIN_VERSION = "1";

/** Vouchers are short-lived: a leaked voucher cannot be redeemed a day later. */
export const VOUCHER_TTL_SECONDS = 30 * 60;

export type MintVoucher = {
  seller: Address;
  listingId: `0x${string}`;
  metadataURIHash: `0x${string}`;
  metadataHash: `0x${string}`;
  termsHash: `0x${string}`;
  nonce: bigint;
  expiry: bigint;
};

export function signerStatus(): { configured: boolean; missing: string | null } {
  const key = process.env["PLATFORM_SIGNER_PRIVATE_KEY"];
  return key
    ? { configured: true, missing: null }
    : { configured: false, missing: "PLATFORM_SIGNER_PRIVATE_KEY" };
}

async function signerAccount() {
  const key = process.env["PLATFORM_SIGNER_PRIVATE_KEY"];
  if (!key) {
    throw new Error(
      "The platform mint signer is not configured (PLATFORM_SIGNER_PRIVATE_KEY). Minting stays disabled until it is set and its address holds SIGNER_ROLE on the registry.",
    );
  }
  const normalised = key.startsWith("0x") ? key : `0x${key}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalised))
    throw new Error("PLATFORM_SIGNER_PRIVATE_KEY is not a 32-byte hex key.");
  const { privateKeyToAccount } = await import("viem/accounts");
  return privateKeyToAccount(normalised as `0x${string}`);
}

export async function platformSignerAddress(): Promise<Address> {
  return (await signerAccount()).address;
}

/**
 * Deterministic per-seller nonce derived from the passport row id, so retrying a failed mint
 * reuses the same voucher slot instead of leaving redeemable vouchers behind.
 */
export function nonceForPassport(passportRowId: string): bigint {
  return BigInt(keccak256(toBytes(passportRowId)).slice(0, 34));
}

export async function signMintVoucher(args: {
  chainId: number;
  registry: Address;
  voucher: MintVoucher;
}): Promise<{ signature: `0x${string}`; signer: Address }> {
  const account = await signerAccount();
  const signature = await account.signTypedData({
    domain: {
      name: EIP712_DOMAIN_NAME,
      version: EIP712_DOMAIN_VERSION,
      chainId: args.chainId,
      verifyingContract: args.registry,
    },
    types: MINT_VOUCHER_TYPES,
    primaryType: "MintVoucher",
    message: args.voucher,
  });
  return { signature, signer: account.address };
}
