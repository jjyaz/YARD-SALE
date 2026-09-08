/**
 * Content-addressing helpers that run anywhere (no server-only APIs).
 * CIDv1 · raw codec (0x55) · sha2-256 multihash · base32 lower-case ("bafkrei…").
 * This is exactly the CID IPFS produces for a single-block file with raw leaves,
 * so a locally computed CID matches what a pinning service returns.
 */

const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

/** Build a CIDv1 (raw, sha2-256) from a 32-byte digest. */
export function cidV1RawFromDigest(digest: Uint8Array): string {
  if (digest.length !== 32) throw new Error("A sha2-256 digest must be 32 bytes.");
  const prefix = Uint8Array.from([0x01, 0x55, 0x12, 0x20]);
  const cid = new Uint8Array(prefix.length + digest.length);
  cid.set(prefix, 0);
  cid.set(digest, prefix.length);
  return `b${base32Encode(cid)}`;
}

export async function cidV1Raw(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", copy.buffer as ArrayBuffer));
  return cidV1RawFromDigest(digest);
}

export function isIpfsUri(uri: string): boolean {
  return uri.startsWith("ipfs://");
}

export function ipfsGatewayUrl(uri: string, gateway: string): string {
  if (!isIpfsUri(uri)) return uri;
  const base = gateway.endsWith("/") ? gateway : `${gateway}/`;
  return `${base}${uri.slice("ipfs://".length)}`;
}
