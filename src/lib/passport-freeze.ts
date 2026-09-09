/**
 * Freezing a passport's photos.
 *
 * Every photo is read once, hashed, and pinned to IPFS *before* any metadata is built, so the
 * frozen JSON only ever references content-addressed `ipfs://` URIs. Whatever later happens to
 * the original file in storage — replaced, deleted, re-uploaded with different bytes — cannot
 * change what the passport points at.
 *
 * The pinning and hashing side effects are injected so this whole path is testable without a
 * network or a database.
 */

export type PinOutcome =
  | { pinned: true; cid: string; verifiedBy: "cid" | "gateway" }
  | { pinned: false; cid: null; missing: string };

export type MediaRef = { storage_path: string | null; ordinal?: number | null };

export type FrozenImage = { url: string; sha256: string; cid: string };

export type PinnedImageRecord = {
  storage_path: string;
  cid: string;
  sha256: string;
  uri: string;
};

export type FreezeImageDeps = {
  media: MediaRef[];
  /** Reads the ORIGINAL bytes from storage. Returning null means the file is gone. */
  download: (path: string) => Promise<{ bytes: Uint8Array; contentType: string } | null>;
  pin: (bytes: Uint8Array, name: string, contentType: string) => Promise<PinOutcome>;
  sha256: (bytes: Uint8Array) => string;
  localCid: (bytes: Uint8Array) => Promise<string>;
};

export async function pinListingImages(
  deps: FreezeImageDeps,
): Promise<{ images: FrozenImage[]; records: PinnedImageRecord[] }> {
  const images: FrozenImage[] = [];
  const records: PinnedImageRecord[] = [];

  for (const item of deps.media) {
    if (!item.storage_path) continue;
    const path = item.storage_path;
    const file = await deps.download(path);
    if (!file) throw new Error(`Photo ${path} could not be read from storage. Nothing was frozen.`);

    const bytes = file.bytes;
    const sha256 = deps.sha256(bytes);
    const expectedCid = await deps.localCid(bytes);

    const filename = path.split("/").pop() || "photo";
    const pinned = await deps.pin(bytes, filename, file.contentType || "application/octet-stream");
    if (!pinned.pinned) {
      throw new Error(
        `Photo ${path} could not be pinned to IPFS (${pinned.missing} is missing). Nothing was frozen.`,
      );
    }
    // A CID the service returned is only trusted when it matches the bytes we hashed, or when the
    // pinner already proved byte-identical read-back for it.
    if (pinned.verifiedBy === "cid" && pinned.cid !== expectedCid) {
      throw new Error(
        `The pinning service returned ${pinned.cid} for ${path} but those bytes hash to ${expectedCid}. Nothing was frozen.`,
      );
    }

    const uri = `ipfs://${pinned.cid}`;
    images.push({ url: uri, sha256, cid: pinned.cid });
    records.push({ storage_path: path, cid: pinned.cid, sha256, uri });
  }

  if (images.length === 0) throw new Error("No readable photos were found for this listing.");
  return { images, records };
}

/**
 * Last line of defence before anything is saved: the frozen JSON must not carry a single
 * mutable reference — no http(s) image URL, no storage path, no signed link.
 */
export function assertOnlyIpfsImages(metadata: { image?: unknown; images?: unknown }): void {
  const refs: unknown[] = [];
  if (metadata.image !== undefined && metadata.image !== null) refs.push(metadata.image);
  if (Array.isArray(metadata.images)) {
    for (const entry of metadata.images) {
      refs.push((entry as { url?: unknown })?.url);
    }
  }
  for (const ref of refs) {
    if (typeof ref !== "string" || !ref.startsWith("ipfs://")) {
      throw new Error(
        `Frozen metadata may only reference content-addressed images, but found ${String(ref)}. Nothing was frozen.`,
      );
    }
  }
}

/** True when a still-valid mint authorisation exists, which blocks re-freezing. */
export function liveVoucherBlock(
  existing: { voucher_expires_at?: string | null } | null | undefined,
  now = Date.now(),
): { blocked: boolean; expiresAt: string | null } {
  const raw = existing?.voucher_expires_at ?? null;
  if (!raw) return { blocked: false, expiresAt: null };
  const expiresAt = new Date(raw).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return { blocked: false, expiresAt: raw };
  return { blocked: true, expiresAt: new Date(expiresAt).toISOString() };
}
