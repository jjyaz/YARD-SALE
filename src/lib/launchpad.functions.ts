import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isHexAddress, publicEnv, ROBINHOOD_MAINNET_ID } from "@/config/env";
import { activeChain } from "@/lib/chain";
import { assetRegistryAbi, companionTokenAbi, erc1167Bytecode, tokenFactoryAbi } from "@/lib/abi";
import {
  attestationComplete,
  buildPassportMetadata,
  canonicalJson,
  COMPANION_TOKEN_DISCLAIMER,
  passportEligibility,
  validateTokenParams,
  type PossessionAttestation,
} from "@/lib/passport-metadata";

const METADATA_BUCKET = "listing-public";

/* ------------------------------------------------------------------ helpers */

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function isTxHash(value: string): value is `0x${string}` {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

function assertAddress(value: string, label: string): asserts value is `0x${string}` {
  if (!isHexAddress(value)) throw new Error(`${label} is not a valid address.`);
}

/** The connected wallet must be one the account has proven ownership of by signature. */
async function requireLinkedWallet(db: Awaited<ReturnType<typeof admin>>, userId: string, wallet: string) {
  const { data } = await db.from("wallets").select("address").eq("user_id", userId);
  const linked = (data ?? []).map((w) => w.address.toLowerCase());
  if (!linked.includes(wallet.toLowerCase())) {
    throw new Error(
      `The connected wallet ${wallet} is not linked to this account. Switch to a linked wallet in your wallet extension, or link this one in Settings.`,
    );
  }
}

type ReceiptOutcome =
  | { kind: "success"; receipt: Awaited<ReturnType<ReturnType<typeof import("viem")["createPublicClient"]>["getTransactionReceipt"]>> }
  | { kind: "reverted"; receipt: Awaited<ReturnType<ReturnType<typeof import("viem")["createPublicClient"]>["getTransactionReceipt"]>> }
  | { kind: "pending" };

async function receiptFor(
  client: Awaited<ReturnType<typeof import("@/lib/launchpad.server")["rpcClient"]>>,
  hash: `0x${string}`,
  waitMs: number,
): Promise<ReceiptOutcome> {
  try {
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: waitMs, pollingInterval: 2_000 });
    return receipt.status === "success" ? { kind: "success", receipt } : { kind: "reverted", receipt };
  } catch {
    return { kind: "pending" };
  }
}

/* ------------------------------------------------------------- launchpad state */

export const getLaunchpadState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin();
    const { verifyDeployment, verifyLiquidityInfra, ipfsPinningStatus } = await import("@/lib/launchpad.server");

    const [{ data: listings }, { data: passports }, { data: tokens }, { data: wallets }, { data: liquidity }, health, liquidityInfra] =
      await Promise.all([
        db
          .from("listings")
          .select("id, slug, title, status, is_demo, terms_version, price_eth, is_free, created_at")
          .eq("seller_id", context.userId)
          .order("created_at", { ascending: false }),
        db.from("item_passports").select("*").eq("user_id", context.userId),
        db.from("companion_tokens").select("*").eq("user_id", context.userId),
        db.from("wallets").select("address, chain_id, verified_at").eq("user_id", context.userId).order("verified_at", { ascending: false }),
        db.from("liquidity_positions").select("*").eq("user_id", context.userId),
        verifyDeployment(),
        verifyLiquidityInfra(),
      ]);

    const mediaCounts = new Map<string, number>();
    const ids = (listings ?? []).map((l) => l.id);
    if (ids.length > 0) {
      const { data: media } = await db.from("listing_media").select("listing_id").in("listing_id", ids);
      for (const row of media ?? []) {
        mediaCounts.set(row.listing_id, (mediaCounts.get(row.listing_id) ?? 0) + 1);
      }
    }

    // A listing can only be minted if the terms version it was published under still
    // resolves to a real row — that row's hash goes on-chain as the immutable terms hash.
    const versions = Array.from(new Set((listings ?? []).map((l) => l.terms_version).filter((v): v is string => Boolean(v))));
    const knownVersions = new Set<string>();
    if (versions.length > 0) {
      const { data: termRows } = await db.from("terms_versions").select("version").in("version", versions);
      for (const row of termRows ?? []) knownVersions.add(row.version);
    }

    const passportByListing = new Map((passports ?? []).map((p) => [p.listing_id, p]));
    const tokenByPassport = new Map((tokens ?? []).map((t) => [t.passport_id, t]));
    const liquidityByToken = new Map((liquidity ?? []).map((l) => [l.token_id, l]));

    return {
      wallets: (wallets ?? []).map((w) => w.address.toLowerCase()),
      chainId: activeChain.id,
      chainName: activeChain.name,
      isMainnet: activeChain.id === ROBINHOOD_MAINNET_ID,
      health,
      liquidityInfra,
      ipfs: ipfsPinningStatus(),
      items: (listings ?? []).map((listing) => {
        const passport = passportByListing.get(listing.id) ?? null;
        const companionToken = passport ? (tokenByPassport.get(passport.id) ?? null) : null;
        const eligibility = passportEligibility({
          status: listing.status,
          is_demo: listing.is_demo,
          terms_version: listing.terms_version,
          mediaCount: mediaCounts.get(listing.id) ?? 0,
          hasConfirmedPassport: passport?.status === "confirmed",
          termsKnown: listing.terms_version ? knownVersions.has(listing.terms_version) : undefined,
        });
        return {
          listing,
          eligibility,
          passport,
          companionToken,
          liquidity: companionToken ? (liquidityByToken.get(companionToken.id) ?? null) : null,
        };
      }),
    };
  });

/* ------------------------------------------------------------ freeze metadata */

export const freezePassportMetadata = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { listingId: string; attestation: PossessionAttestation }) => {
    if (!input.listingId) throw new Error("A listing is required.");
    if (!attestationComplete(input.attestation)) throw new Error("Every possession statement must be confirmed.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { requireVerifiedDeployment, pinJsonToIpfs, ipfsPinningStatus } = await import("@/lib/launchpad.server");
    const { cidV1Raw } = await import("@/lib/ipfs");
    const config = await requireVerifiedDeployment();
    const db = await admin();
    const { keccak256, toBytes } = await import("viem");
    const { createHash } = await import("node:crypto");

    const { data: listing, error } = await db
      .from("listings")
      .select("*")
      .eq("id", data.listingId)
      .eq("seller_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!listing) throw new Error("Listing not found.");

    const { data: existing } = await db.from("item_passports").select("*").eq("listing_id", listing.id).maybeSingle();
    if (existing && existing.status !== "frozen" && existing.status !== "failed") {
      throw new Error(
        existing.status === "confirmed"
          ? "This passport is already minted; its metadata is permanent."
          : "A mint transaction is pending for this listing. Check it before re-freezing.",
      );
    }

    // On mainnet the token URI must be permanent: require IPFS pinning.
    const pinning = ipfsPinningStatus();
    if (config.chainId === ROBINHOOD_MAINNET_ID && !pinning.configured) {
      throw new Error(`IPFS pinning is not configured: the ${pinning.missing} secret is missing. Mainnet passports require a permanent ipfs:// metadata URI.`);
    }

    const [{ data: media }, { data: profile }, { data: terms }] = await Promise.all([
      db.from("listing_media").select("storage_path, public_url, ordinal").eq("listing_id", listing.id).order("ordinal"),
      db.from("profiles").select("handle").eq("id", context.userId).maybeSingle(),
      listing.terms_version
        ? db.from("terms_versions").select("version, body, terms_hash").eq("version", listing.terms_version).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const eligibility = passportEligibility({
      status: listing.status,
      is_demo: listing.is_demo,
      terms_version: listing.terms_version,
      mediaCount: media?.length ?? 0,
      hasConfirmedPassport: false,
      termsKnown: listing.terms_version ? Boolean(terms) : undefined,
    });
    if (!eligibility.eligible) throw new Error(`This listing is not eligible: ${eligibilityLabel[eligibility.reason]}.`);
    if (!terms) throw new Error(`Terms version ${listing.terms_version} was not found, so the terms hash cannot be computed.`);

    // The terms hash commits to the exact wording the seller accepted.
    const termsHash = keccak256(toBytes(terms.body));

    // Hash the real photo bytes so the metadata fingerprint is verifiable.
    const images: { url: string; sha256: string }[] = [];
    for (const item of media ?? []) {
      if (!item.storage_path) continue;
      const { data: file, error: downloadError } = await db.storage.from(METADATA_BUCKET).download(item.storage_path);
      if (downloadError || !file) {
        throw new Error(`Photo ${item.storage_path} could not be read from storage: ${downloadError?.message ?? "missing"}`);
      }
      const bytes = Buffer.from(await file.arrayBuffer());
      images.push({
        url: item.public_url ?? item.storage_path,
        sha256: `0x${createHash("sha256").update(bytes).digest("hex")}`,
      });
    }
    if (images.length === 0) throw new Error("No readable photos were found for this listing.");

    const now = new Date().toISOString();
    const metadata = buildPassportMetadata({
      listingId: listing.id,
      slug: listing.slug,
      title: listing.title,
      description: listing.description,
      category: listing.category,
      condition: listing.condition,
      conditionNotes: listing.condition_notes,
      brand: listing.brand,
      model: listing.model,
      year: listing.year,
      dimensions: listing.dimensions,
      city: listing.city,
      region: listing.region,
      priceEth: listing.price_eth,
      isFree: listing.is_free,
      termsVersion: terms.version,
      termsHash,
      sellerHandle: profile?.handle ?? "",
      images,
      frozenAt: now,
      chainId: config.chainId,
      registry: config.registry,
      attestation: data.attestation,
      attestedAt: now,
    });

    const canonical = canonicalJson(metadata);
    const canonicalBytes = new TextEncoder().encode(canonical);
    const metadataHash = keccak256(canonicalBytes);
    const listingKey = keccak256(toBytes(listing.id));
    const computedCid = await cidV1Raw(canonicalBytes);

    // Always keep a copy in storage (private bucket → long-lived signed URL as a fallback resolver).
    const path = `passports/${listing.id}.json`;
    const { error: uploadError } = await db.storage
      .from(METADATA_BUCKET)
      .upload(path, new Blob([canonical], { type: "application/json" }), { upsert: true, contentType: "application/json" });
    if (uploadError) throw new Error(`Metadata upload failed: ${uploadError.message}`);
    const { data: signed, error: signError } = await db.storage.from(METADATA_BUCKET).createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
    if (signError || !signed?.signedUrl) throw new Error(`Metadata URL could not be created: ${signError?.message ?? "unknown error"}`);

    // Pin to IPFS when configured. The URI is ipfs:// only if the pin really happened.
    const pin = await pinJsonToIpfs(canonical, `yardsale-passport-${listing.id}`);
    const metadataUri = pin.pinned ? `ipfs://${pin.cid}` : signed.signedUrl;

    const row = {
      listing_id: listing.id,
      user_id: context.userId,
      chain_id: config.chainId,
      contract_address: config.registry.toLowerCase(),
      wallet_address: "",
      metadata_uri: metadataUri,
      storage_url: signed.signedUrl,
      ipfs_cid: pin.pinned ? pin.cid : computedCid,
      ipfs_pinned_at: pin.pinned ? now : null,
      metadata_hash: metadataHash,
      terms_hash: termsHash,
      listing_key: listingKey,
      image_hashes: images,
      metadata_snapshot: metadata,
      attestation: { ...data.attestation, attested_at: now },
      status: "frozen" as const,
      failure_reason: null,
      tx_hash: null,
      submitted_at: null,
      token_id: null,
      block_number: null,
      confirmed_at: null,
    };

    const { data: saved, error: saveError } = existing
      ? await db.from("item_passports").update(row).eq("id", existing.id).select("*").single()
      : await db.from("item_passports").insert(row).select("*").single();
    if (saveError) throw new Error(saveError.message);
    return { passport: saved, pinned: pin.pinned, pinningMissing: pin.pinned ? null : pin.missing, computedCid };
  });

/* ---------------------------------------------------------- mint preparation */

export const prepareMint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { listingId: string; wallet: string }) => {
    assertAddress(input.wallet, "Wallet");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { requireVerifiedDeployment, rpcClient } = await import("@/lib/launchpad.server");
    const { encodeFunctionData, getAddress, formatEther } = await import("viem");
    const config = await requireVerifiedDeployment();
    const db = await admin();
    await requireLinkedWallet(db, context.userId, data.wallet);

    const { data: passport } = await db
      .from("item_passports")
      .select("*")
      .eq("listing_id", data.listingId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!passport) throw new Error("Freeze the passport metadata first.");
    if (passport.status === "confirmed") throw new Error("This passport is already minted.");
    if (passport.status === "submitted" && passport.tx_hash) {
      throw new Error("A mint transaction is already pending for this listing. Check it before sending another.");
    }
    if (passport.chain_id !== config.chainId || passport.contract_address !== config.registry.toLowerCase()) {
      throw new Error("The frozen metadata targets a different chain or registry. Re-freeze it for the current configuration.");
    }

    const client = rpcClient(config.chainId);
    const wallet = getAddress(data.wallet);
    const existingTokenId = await client.readContract({
      address: config.registry,
      abi: assetRegistryAbi,
      functionName: "tokenIdForListing",
      args: [passport.listing_key as `0x${string}`],
    });
    if (existingTokenId !== 0n) {
      return { alreadyMinted: true as const, tokenId: existingTokenId.toString() };
    }

    const args = [
      wallet,
      passport.listing_key as `0x${string}`,
      passport.metadata_uri,
      passport.metadata_hash as `0x${string}`,
      passport.terms_hash as `0x${string}`,
    ] as const;
    const calldata = encodeFunctionData({ abi: assetRegistryAbi, functionName: "mintPassport", args });

    const [balance, gasPrice] = await Promise.all([client.getBalance({ address: wallet }), client.getGasPrice()]);
    let gasEstimate: bigint | null = null;
    let gasError: string | null = null;
    try {
      gasEstimate = await client.estimateContractGas({
        address: config.registry,
        abi: assetRegistryAbi,
        functionName: "mintPassport",
        args,
        account: wallet,
      });
    } catch (error) {
      gasError = (error as Error).message.split("\n").slice(0, 2).join(" ");
    }
    const feeWei = gasEstimate ? gasEstimate * gasPrice : null;

    return {
      alreadyMinted: false as const,
      chainId: config.chainId,
      to: config.registry,
      data: calldata,
      args: {
        to: wallet,
        listingId: passport.listing_key,
        metadataURI: passport.metadata_uri,
        metadataHash: passport.metadata_hash,
        termsHash: passport.terms_hash,
      },
      wallet,
      balanceWei: balance.toString(),
      balanceEth: formatEther(balance),
      gasPriceWei: gasPrice.toString(),
      gasEstimate: gasEstimate?.toString() ?? null,
      feeEstimateEth: feeWei !== null ? formatEther(feeWei) : null,
      gasError,
      insufficientFunds: feeWei !== null ? balance < feeWei : gasError?.toLowerCase().includes("insufficient") ? true : false,
    };
  });

/* --------------------------------------------------------- mint submission */

export const recordMintSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { listingId: string; txHash: string; wallet: string }) => {
    if (!isTxHash(input.txHash)) throw new Error("Invalid transaction hash.");
    assertAddress(input.wallet, "Wallet");
    return input;
  })
  .handler(async ({ data, context }) => {
    const db = await admin();
    await requireLinkedWallet(db, context.userId, data.wallet);
    const { data: passport } = await db
      .from("item_passports")
      .select("*")
      .eq("listing_id", data.listingId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!passport) throw new Error("Freeze the passport metadata first.");
    if (passport.status === "confirmed") throw new Error("This passport is already minted.");
    if (passport.status === "submitted" && passport.tx_hash && passport.tx_hash !== data.txHash) {
      throw new Error("Another mint transaction is already pending for this listing.");
    }

    const { data: saved, error } = await db
      .from("item_passports")
      .update({
        status: "submitted",
        tx_hash: data.txHash,
        wallet_address: data.wallet.toLowerCase(),
        submitted_at: new Date().toISOString(),
        failure_reason: null,
      })
      .eq("id", passport.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return saved;
  });

/* -------------------------------------------------- mint receipt verification */

export const reconcilePassport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { listingId: string; waitMs?: number }) => input)
  .handler(async ({ data, context }) => {
    const { requireVerifiedDeployment, rpcClient } = await import("@/lib/launchpad.server");
    const { decodeEventLog, getAddress, parseAbiItem } = await import("viem");
    const config = await requireVerifiedDeployment();
    const db = await admin();
    const client = rpcClient(config.chainId);
    const now = new Date().toISOString();

    const { data: passport } = await db
      .from("item_passports")
      .select("*")
      .eq("listing_id", data.listingId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!passport) throw new Error("No passport record for this listing.");
    if (passport.status === "confirmed") return { outcome: "confirmed" as const, passport, message: "Already verified." };

    const registry = getAddress(config.registry);
    const listingKey = passport.listing_key as `0x${string}`;

    type Minted = { tokenId: bigint; owner: string; metadataHash: string; termsHash: string; txHash: string | null; blockNumber: bigint | null };
    let minted: Minted | null = null;

    // 1) Receipt path.
    if (passport.tx_hash && isTxHash(passport.tx_hash)) {
      const outcome = await receiptFor(client, passport.tx_hash, Math.min(Math.max(data.waitMs ?? 60_000, 5_000), 120_000));
      if (outcome.kind === "reverted") {
        const { data: failed } = await db
          .from("item_passports")
          .update({ status: "failed", failure_reason: "The mint transaction reverted on-chain. Nothing was minted.", last_reconciled_at: now })
          .eq("id", passport.id)
          .select("*")
          .single();
        return { outcome: "failed" as const, passport: failed, message: "The mint transaction reverted." };
      }
      if (outcome.kind === "success") {
        for (const log of outcome.receipt.logs) {
          if (getAddress(log.address) !== registry) continue;
          try {
            const decoded = decodeEventLog({ abi: assetRegistryAbi, data: log.data, topics: log.topics });
            if (decoded.eventName !== "PassportMinted") continue;
            const args = decoded.args as unknown as { tokenId: bigint; owner: string; listingId: string; metadataHash: string; termsHash: string };
            if (args.listingId.toLowerCase() !== listingKey.toLowerCase()) continue;
            minted = { ...args, txHash: outcome.receipt.transactionHash, blockNumber: outcome.receipt.blockNumber };
            break;
          } catch {
            continue;
          }
        }
        if (!minted) throw new Error("The transaction succeeded but contains no PassportMinted event for this listing. Nothing was saved.");
      }
    }

    // 2) Chain-state recovery (lost hash, dropped/replaced tx, or refresh before the receipt arrived).
    if (!minted) {
      const tokenId = await client.readContract({ address: registry, abi: assetRegistryAbi, functionName: "tokenIdForListing", args: [listingKey] });
      if (tokenId === 0n) {
        const { data: pending } = await db.from("item_passports").update({ last_reconciled_at: now }).eq("id", passport.id).select("*").single();
        return {
          outcome: "pending" as const,
          passport: pending,
          message: passport.tx_hash
            ? "The transaction has not been mined yet and no passport exists on-chain for this listing. Check again shortly."
            : "No transaction is pending and no passport exists on-chain.",
        };
      }
      const [record, owner] = await Promise.all([
        client.readContract({ address: registry, abi: assetRegistryAbi, functionName: "passport", args: [tokenId] }),
        client.readContract({ address: registry, abi: assetRegistryAbi, functionName: "ownerOf", args: [tokenId] }),
      ]);
      let txHash: string | null = null;
      let blockNumber: bigint | null = null;
      try {
        const logs = await client.getLogs({
          address: registry,
          event: parseAbiItem(
            "event PassportMinted(uint256 indexed tokenId, address indexed owner, bytes32 indexed listingId, string metadataURI, bytes32 metadataHash, bytes32 termsHash)",
          ),
          args: { listingId: listingKey },
          fromBlock: 0n,
          toBlock: "latest",
        });
        const hit = logs.find((l) => l.args.tokenId === tokenId);
        if (hit) {
          txHash = hit.transactionHash;
          blockNumber = hit.blockNumber;
        }
      } catch {
        // Log lookup is best-effort; chain state alone is authoritative.
      }
      minted = { tokenId, owner, metadataHash: record.metadataHash, termsHash: record.termsHash, txHash, blockNumber };
    }

    // 3) Verify the on-chain record matches what was frozen, then persist.
    if (minted.metadataHash.toLowerCase() !== passport.metadata_hash.toLowerCase()) {
      throw new Error("On-chain metadata fingerprint does not match the frozen metadata. Nothing was saved.");
    }
    if (minted.termsHash.toLowerCase() !== passport.terms_hash.toLowerCase()) {
      throw new Error("On-chain terms fingerprint does not match. Nothing was saved.");
    }
    const onChainOwner = await client.readContract({ address: registry, abi: assetRegistryAbi, functionName: "ownerOf", args: [minted.tokenId] });
    if (getAddress(onChainOwner) !== getAddress(minted.owner)) throw new Error("Passport owner could not be confirmed on-chain. Nothing was saved.");

    const { data: confirmed, error } = await db
      .from("item_passports")
      .update({
        status: "confirmed",
        token_id: minted.tokenId.toString() as unknown as number,
        wallet_address: minted.owner.toLowerCase(),
        tx_hash: minted.txHash ?? passport.tx_hash,
        block_number: minted.blockNumber !== null ? Number(minted.blockNumber) : passport.block_number,
        confirmed_at: now,
        last_reconciled_at: now,
        failure_reason: null,
      })
      .eq("id", passport.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await db.from("listings").update({ passport_minted: true }).eq("id", passport.listing_id);
    return { outcome: "confirmed" as const, passport: confirmed, message: "Item Passport verified on-chain." };
  });

/** Clears a submitted-but-never-mined mint so the seller can try again. Refuses if anything exists on-chain. */
export const resetStalledMint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { listingId: string }) => input)
  .handler(async ({ data, context }) => {
    const { requireVerifiedDeployment, rpcClient } = await import("@/lib/launchpad.server");
    const config = await requireVerifiedDeployment();
    const db = await admin();
    const client = rpcClient(config.chainId);
    const { data: passport } = await db
      .from("item_passports")
      .select("*")
      .eq("listing_id", data.listingId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!passport) throw new Error("No passport record for this listing.");
    if (passport.status !== "submitted" && passport.status !== "failed") throw new Error("Only a pending or failed mint can be reset.");

    const tokenId = await client.readContract({
      address: config.registry,
      abi: assetRegistryAbi,
      functionName: "tokenIdForListing",
      args: [passport.listing_key as `0x${string}`],
    });
    if (tokenId !== 0n) throw new Error("A passport already exists on-chain for this listing. Use “Check the pending transaction” to recover it instead.");
    if (passport.tx_hash && isTxHash(passport.tx_hash)) {
      const receipt = await client.getTransactionReceipt({ hash: passport.tx_hash }).catch(() => null);
      if (receipt?.status === "success") throw new Error("That transaction was mined. Use “Check the pending transaction” to recover it.");
      const ageMs = passport.submitted_at ? Date.now() - new Date(passport.submitted_at).getTime() : Number.POSITIVE_INFINITY;
      if (!receipt && ageMs < 5 * 60_000) throw new Error("Give the transaction at least five minutes before resetting.");
    }
    const { data: reset, error } = await db
      .from("item_passports")
      .update({ status: "frozen", tx_hash: null, submitted_at: null, failure_reason: null, last_reconciled_at: new Date().toISOString() })
      .eq("id", passport.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return reset;
  });

/* -------------------------------------------------- companion token creation */

const tokenInputValidator = (input: {
  listingId: string;
  wallet: string;
  name: string;
  symbol: string;
  totalSupply: string;
  creatorAllocation: string;
  disclaimerAccepted: boolean;
}) => {
  assertAddress(input.wallet, "Wallet");
  if (!input.disclaimerAccepted) throw new Error("The no-rights acknowledgement is required.");
  if (!/^\d+$/.test(input.totalSupply) || !/^\d+$/.test(input.creatorAllocation)) {
    throw new Error("Supply and allocation must be whole numbers of base units.");
  }
  const problem = validateTokenParams({
    name: input.name,
    symbol: input.symbol,
    totalSupply: BigInt(input.totalSupply),
    creatorAllocation: BigInt(input.creatorAllocation),
  });
  if (problem) throw new Error(problem);
  return input;
};

export const prepareToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(tokenInputValidator)
  .handler(async ({ data, context }) => {
    const { requireVerifiedDeployment, rpcClient } = await import("@/lib/launchpad.server");
    const { encodeFunctionData, getAddress, formatEther } = await import("viem");
    const config = await requireVerifiedDeployment();
    const db = await admin();
    await requireLinkedWallet(db, context.userId, data.wallet);

    const { data: passport } = await db
      .from("item_passports")
      .select("*")
      .eq("listing_id", data.listingId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!passport || passport.status !== "confirmed" || passport.token_id === null) {
      throw new Error("Mint and confirm the Item Passport before creating a companion token.");
    }
    const { data: existing } = await db.from("companion_tokens").select("*").eq("passport_id", passport.id).maybeSingle();
    if (existing?.status === "confirmed") throw new Error("This passport already has a companion token. The pairing is permanent.");
    if (existing?.status === "submitted" && existing.tx_hash) {
      throw new Error("A companion token transaction is already pending for this passport. Check it before sending another.");
    }

    const client = rpcClient(config.chainId);
    const wallet = getAddress(data.wallet);
    const passportTokenId = BigInt(String(passport.token_id));
    const [owner, existingToken, predicted] = await Promise.all([
      client.readContract({ address: config.registry, abi: assetRegistryAbi, functionName: "ownerOf", args: [passportTokenId] }),
      client.readContract({ address: config.factory, abi: tokenFactoryAbi, functionName: "tokenForPassport", args: [passportTokenId] }),
      client.readContract({ address: config.factory, abi: tokenFactoryAbi, functionName: "predictTokenAddress", args: [passportTokenId] }),
    ]);
    if (getAddress(owner) !== wallet) {
      throw new Error(`Passport #${passportTokenId} is owned by ${owner}, not by the connected wallet. Only the passport owner can launch its token.`);
    }
    if (existingToken !== "0x0000000000000000000000000000000000000000") {
      return { alreadyCreated: true as const, tokenAddress: existingToken };
    }

    const args = [passportTokenId, data.name.trim(), data.symbol.trim().toUpperCase(), BigInt(data.totalSupply), BigInt(data.creatorAllocation)] as const;
    const calldata = encodeFunctionData({ abi: tokenFactoryAbi, functionName: "createCompanionToken", args });
    const [balance, gasPrice] = await Promise.all([client.getBalance({ address: wallet }), client.getGasPrice()]);
    let gasEstimate: bigint | null = null;
    let gasError: string | null = null;
    try {
      gasEstimate = await client.estimateContractGas({ address: config.factory, abi: tokenFactoryAbi, functionName: "createCompanionToken", args, account: wallet });
    } catch (error) {
      gasError = (error as Error).message.split("\n").slice(0, 2).join(" ");
    }
    const feeWei = gasEstimate ? gasEstimate * gasPrice : null;

    return {
      alreadyCreated: false as const,
      chainId: config.chainId,
      to: config.factory,
      data: calldata,
      predictedAddress: predicted,
      implementation: config.implementation,
      args: {
        passportTokenId: passportTokenId.toString(),
        name: data.name.trim(),
        symbol: data.symbol.trim().toUpperCase(),
        totalSupply: data.totalSupply,
        creatorAllocation: data.creatorAllocation,
        treasuryAllocation: (BigInt(data.totalSupply) - BigInt(data.creatorAllocation)).toString(),
      },
      wallet,
      balanceEth: formatEther(balance),
      gasEstimate: gasEstimate?.toString() ?? null,
      feeEstimateEth: feeWei !== null ? formatEther(feeWei) : null,
      gasError,
      insufficientFunds: feeWei !== null ? balance < feeWei : Boolean(gasError?.toLowerCase().includes("insufficient")),
    };
  });

export const recordTokenSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: Parameters<typeof tokenInputValidator>[0] & { txHash: string }) => {
    if (!isTxHash(input.txHash)) throw new Error("Invalid transaction hash.");
    tokenInputValidator(input);
    return input;
  })
  .handler(async ({ data, context }) => {
    const { requireVerifiedDeployment } = await import("@/lib/launchpad.server");
    const config = await requireVerifiedDeployment();
    const db = await admin();
    await requireLinkedWallet(db, context.userId, data.wallet);

    const { data: passport } = await db
      .from("item_passports")
      .select("*")
      .eq("listing_id", data.listingId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!passport || passport.status !== "confirmed") {
      throw new Error("Mint and confirm the Item Passport before creating a companion token.");
    }

    const { data: existing } = await db.from("companion_tokens").select("*").eq("passport_id", passport.id).maybeSingle();
    if (existing?.status === "confirmed") throw new Error("This passport already has a companion token.");
    if (existing?.status === "submitted" && existing.tx_hash && existing.tx_hash !== data.txHash) {
      throw new Error("Another companion token transaction is already pending for this passport.");
    }

    const now = new Date().toISOString();
    const row = {
      passport_id: passport.id,
      listing_id: passport.listing_id,
      user_id: context.userId,
      chain_id: config.chainId,
      factory_address: config.factory.toLowerCase(),
      implementation_address: config.implementation.toLowerCase(),
      wallet_address: data.wallet.toLowerCase(),
      name: data.name.trim(),
      symbol: data.symbol.trim().toUpperCase(),
      // Exact base-unit integers as decimal strings — never JS numbers, which lose
      // precision above 2^53 and would make the on-chain comparison impossible.
      total_supply: BigInt(data.totalSupply).toString(),
      creator_allocation: BigInt(data.creatorAllocation).toString(),
      tx_hash: data.txHash,
      status: "submitted" as const,
      failure_reason: null,
      submitted_at: now,
      disclaimer_accepted_at: now,
      token_address: null,
      block_number: null,
      confirmed_at: null,
    };

    const { data: saved, error } = existing
      ? await db.from("companion_tokens").update(row).eq("id", existing.id).select("*").single()
      : await db.from("companion_tokens").insert(row).select("*").single();
    if (error) throw new Error(error.message);
    return saved;
  });

export const reconcileCompanionToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { listingId: string; waitMs?: number }) => input)
  .handler(async ({ data, context }) => {
    const { requireVerifiedDeployment, rpcClient } = await import("@/lib/launchpad.server");
    const { decodeEventLog, getAddress, keccak256, zeroAddress } = await import("viem");
    const config = await requireVerifiedDeployment();
    const db = await admin();
    const client = rpcClient(config.chainId);
    const now = new Date().toISOString();

    const { data: token } = await db
      .from("companion_tokens")
      .select("*")
      .eq("listing_id", data.listingId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!token) throw new Error("No companion token record for this listing.");
    if (token.status === "confirmed") return { outcome: "confirmed" as const, token, message: "Already verified." };

    const { data: passport } = await db.from("item_passports").select("*").eq("id", token.passport_id).single();
    if (!passport?.token_id) throw new Error("The passport for this token is not confirmed.");
    const passportTokenId = BigInt(String(passport.token_id));
    const factory = getAddress(config.factory);

    type Created = { token: string; creator: string; totalSupply: bigint; creatorAllocation: bigint; txHash: string | null; blockNumber: bigint | null };
    let created: Created | null = null;

    if (token.tx_hash && isTxHash(token.tx_hash)) {
      const outcome = await receiptFor(client, token.tx_hash, Math.min(Math.max(data.waitMs ?? 60_000, 5_000), 120_000));
      if (outcome.kind === "reverted") {
        const { data: failed } = await db
          .from("companion_tokens")
          .update({ status: "failed", failure_reason: "The token deployment transaction reverted on-chain. No token was created.", last_reconciled_at: now })
          .eq("id", token.id)
          .select("*")
          .single();
        return { outcome: "failed" as const, token: failed, message: "The deployment reverted." };
      }
      if (outcome.kind === "success") {
        for (const log of outcome.receipt.logs) {
          if (getAddress(log.address) !== factory) continue;
          try {
            const decoded = decodeEventLog({ abi: tokenFactoryAbi, data: log.data, topics: log.topics });
            if (decoded.eventName !== "CompanionTokenCreated") continue;
            const args = decoded.args as unknown as { passportTokenId: bigint; token: string; creator: string; totalSupply: bigint; creatorAllocation: bigint };
            if (args.passportTokenId !== passportTokenId) continue;
            created = { ...args, txHash: outcome.receipt.transactionHash, blockNumber: outcome.receipt.blockNumber };
            break;
          } catch {
            continue;
          }
        }
        if (!created) throw new Error("The transaction succeeded but contains no CompanionTokenCreated event for this passport. Nothing was saved.");
      }
    }

    if (!created) {
      const onChainToken = await client.readContract({ address: factory, abi: tokenFactoryAbi, functionName: "tokenForPassport", args: [passportTokenId] });
      if (onChainToken === zeroAddress) {
        const { data: pending } = await db.from("companion_tokens").update({ last_reconciled_at: now }).eq("id", token.id).select("*").single();
        return { outcome: "pending" as const, token: pending, message: "The deployment has not been mined yet and no token exists for this passport." };
      }
      const [creator, totalSupply] = await Promise.all([
        client.readContract({ address: getAddress(onChainToken), abi: companionTokenAbi, functionName: "creator" }),
        client.readContract({ address: getAddress(onChainToken), abi: companionTokenAbi, functionName: "totalSupply" }),
      ]);
      const creatorBalance = await client.readContract({ address: getAddress(onChainToken), abi: companionTokenAbi, functionName: "balanceOf", args: [getAddress(creator)] });
      created = { token: onChainToken, creator, totalSupply, creatorAllocation: creatorBalance, txHash: null, blockNumber: null };
    }

    const tokenAddress = getAddress(created.token);
    // Real deployed bytecode: must be exactly an ERC-1167 clone of the verified implementation.
    const bytecode = await client.getCode({ address: tokenAddress });
    if (!bytecode || bytecode === "0x") throw new Error("No contract code at the token address. Nothing was saved.");
    const expected = erc1167Bytecode(config.implementation);
    if (bytecode.toLowerCase() !== expected) {
      throw new Error("The deployed bytecode is not a minimal clone of the verified token implementation. Nothing was saved.");
    }

    const [totalSupply, creatorBalance, pairedTokenId, pairedOnRegistry, tokenFactory, tokenRegistry, passportForToken] = await Promise.all([
      client.readContract({ address: tokenAddress, abi: companionTokenAbi, functionName: "totalSupply" }),
      client.readContract({ address: tokenAddress, abi: companionTokenAbi, functionName: "balanceOf", args: [getAddress(created.creator)] }),
      client.readContract({ address: tokenAddress, abi: companionTokenAbi, functionName: "passportTokenId" }),
      client.readContract({ address: getAddress(config.registry), abi: assetRegistryAbi, functionName: "companionTokenOf", args: [passportTokenId] }),
      client.readContract({ address: tokenAddress, abi: companionTokenAbi, functionName: "factory" }),
      client.readContract({ address: tokenAddress, abi: companionTokenAbi, functionName: "registry" }),
      client.readContract({ address: factory, abi: tokenFactoryAbi, functionName: "passportForToken", args: [tokenAddress] }),
    ]);

    if (totalSupply !== BigInt(String(token.total_supply))) throw new Error("On-chain total supply does not match what you submitted. Nothing was saved.");
    if (creatorBalance !== BigInt(String(token.creator_allocation))) throw new Error("On-chain creator allocation does not match what you submitted. Nothing was saved.");
    if (getAddress(created.creator) !== getAddress(token.wallet_address)) throw new Error("The token creator is not the submitting wallet. Nothing was saved.");
    if (pairedTokenId !== passportTokenId || passportForToken !== passportTokenId) throw new Error("The token is not bound to this passport. Nothing was saved.");
    if (getAddress(pairedOnRegistry) !== tokenAddress) throw new Error("The registry is not paired with this token. Nothing was saved.");
    if (getAddress(tokenFactory) !== factory || getAddress(tokenRegistry) !== getAddress(config.registry)) {
      throw new Error("The token does not point back at the verified factory and registry. Nothing was saved.");
    }

    const { data: confirmed, error } = await db
      .from("companion_tokens")
      .update({
        status: "confirmed",
        token_address: tokenAddress.toLowerCase(),
        implementation_address: config.implementation.toLowerCase(),
        bytecode_hash: keccak256(bytecode),
        tx_hash: created.txHash ?? token.tx_hash,
        block_number: created.blockNumber !== null ? Number(created.blockNumber) : token.block_number,
        confirmed_at: now,
        last_reconciled_at: now,
        failure_reason: null,
      })
      .eq("id", token.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await db.from("listings").update({ companion_token: true }).eq("id", token.listing_id);
    return { outcome: "confirmed" as const, token: confirmed, message: "Companion token verified and permanently paired." };
  });

export const resetStalledToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { listingId: string }) => input)
  .handler(async ({ data, context }) => {
    const { requireVerifiedDeployment, rpcClient } = await import("@/lib/launchpad.server");
    const { zeroAddress } = await import("viem");
    const config = await requireVerifiedDeployment();
    const db = await admin();
    const client = rpcClient(config.chainId);
    const { data: token } = await db
      .from("companion_tokens")
      .select("*")
      .eq("listing_id", data.listingId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!token) throw new Error("No companion token record for this listing.");
    if (token.status !== "submitted" && token.status !== "failed") throw new Error("Only a pending or failed deployment can be reset.");
    const { data: passport } = await db.from("item_passports").select("token_id").eq("id", token.passport_id).single();
    if (!passport?.token_id) throw new Error("The passport is not confirmed.");
    const onChain = await client.readContract({ address: config.factory, abi: tokenFactoryAbi, functionName: "tokenForPassport", args: [BigInt(String(passport.token_id))] });
    if (onChain !== zeroAddress) throw new Error("A token already exists on-chain for this passport. Use “Check the pending deployment” to recover it.");
    if (token.tx_hash && isTxHash(token.tx_hash)) {
      const receipt = await client.getTransactionReceipt({ hash: token.tx_hash }).catch(() => null);
      if (receipt?.status === "success") throw new Error("That transaction was mined. Use “Check the pending deployment” to recover it.");
      const ageMs = token.submitted_at ? Date.now() - new Date(token.submitted_at).getTime() : Number.POSITIVE_INFINITY;
      if (!receipt && ageMs < 5 * 60_000) throw new Error("Give the transaction at least five minutes before resetting.");
    }
    const { error } = await db.from("companion_tokens").delete().eq("id", token.id);
    if (error) throw new Error(error.message);
    return { reset: true };
  });

export const launchpadDisclaimer = COMPANION_TOKEN_DISCLAIMER;
