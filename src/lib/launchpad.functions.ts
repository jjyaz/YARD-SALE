import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { publicEnv, ROBINHOOD_MAINNET_ID } from "@/config/env";
import { defaultChain } from "@/lib/chain";
import { assetRegistryAbi, companionTokenAbi, tokenFactoryAbi } from "@/lib/abi";
import {
  buildPassportMetadata,
  canonicalJson,
  COMPANION_TOKEN_DISCLAIMER,
  passportEligibility,
} from "@/lib/passport-metadata";

const METADATA_BUCKET = "listing-public";

/* ------------------------------------------------------------------ helpers */

function requireChainConfig() {
  const missing: string[] = [];
  if (!publicEnv.assetRegistryAddress) missing.push("VITE_ASSET_REGISTRY_ADDRESS");
  if (!publicEnv.testnetRpcUrl) missing.push("VITE_ROBINHOOD_TESTNET_RPC_URL");
  if (missing.length > 0) {
    throw new Error(`Missing configuration: ${missing.join(", ")}. Deploy the contracts and set these values.`);
  }
  if (defaultChain.id === ROBINHOOD_MAINNET_ID) {
    throw new Error("Mainnet writes are disabled in this phase. Switch the app to Robinhood Chain testnet (46630).");
  }
  return {
    registry: publicEnv.assetRegistryAddress as `0x${string}`,
    factory: publicEnv.tokenFactoryAddress as `0x${string}`,
    chainId: defaultChain.id,
  };
}

async function publicClient() {
  const { createPublicClient, http } = await import("viem");
  return createPublicClient({ chain: defaultChain, transport: http() });
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function isTxHash(value: string): value is `0x${string}` {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

/* ------------------------------------------------------------- launchpad state */

export const getLaunchpadState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin();

    const [{ data: listings }, { data: passports }, { data: tokens }, { data: wallets }] = await Promise.all([
      db
        .from("listings")
        .select("id, slug, title, status, is_demo, terms_version, price_eth, is_free, created_at")
        .eq("seller_id", context.userId)
        .order("created_at", { ascending: false }),
      db.from("item_passports").select("*").eq("user_id", context.userId),
      db.from("companion_tokens").select("*").eq("user_id", context.userId),
      db.from("wallets").select("address, chain_id").eq("user_id", context.userId),
    ]);

    const mediaCounts = new Map<string, number>();
    const ids = (listings ?? []).map((l) => l.id);
    if (ids.length > 0) {
      const { data: media } = await db.from("listing_media").select("listing_id").in("listing_id", ids);
      for (const row of media ?? []) {
        mediaCounts.set(row.listing_id, (mediaCounts.get(row.listing_id) ?? 0) + 1);
      }
    }

    const passportByListing = new Map((passports ?? []).map((p) => [p.listing_id, p]));
    const tokenByPassport = new Map((tokens ?? []).map((t) => [t.passport_id, t]));

    return {
      wallet: wallets?.[0]?.address ?? null,
      chainId: defaultChain.id,
      chainName: defaultChain.name,
      registryAddress: publicEnv.assetRegistryAddress || null,
      factoryAddress: publicEnv.tokenFactoryAddress || null,
      mainnetEnabled: publicEnv.enableMainnet,
      items: (listings ?? []).map((listing) => {
        const passport = passportByListing.get(listing.id) ?? null;
        const eligibility = passportEligibility({
          status: listing.status,
          is_demo: listing.is_demo,
          terms_version: listing.terms_version,
          mediaCount: mediaCounts.get(listing.id) ?? 0,
          hasConfirmedPassport: passport?.status === "confirmed",
        });
        return {
          listing,
          eligibility,
          passport,
          companionToken: passport ? (tokenByPassport.get(passport.id) ?? null) : null,
        };
      }),
    };
  });

/* ------------------------------------------------------------ freeze metadata */

export const freezePassportMetadata = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { listingId: string }) => {
    if (!input.listingId) throw new Error("A listing is required.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const config = requireChainConfig();
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

    const { data: existing } = await db
      .from("item_passports")
      .select("*")
      .eq("listing_id", listing.id)
      .maybeSingle();
    if (existing && existing.status !== "frozen" && existing.status !== "failed") {
      return existing;
    }

    const { data: media } = await db
      .from("listing_media")
      .select("storage_path, public_url, ordinal")
      .eq("listing_id", listing.id)
      .order("ordinal");

    const { data: profile } = await db
      .from("profiles")
      .select("handle")
      .eq("id", context.userId)
      .maybeSingle();

    const eligibility = passportEligibility({
      status: listing.status,
      is_demo: listing.is_demo,
      terms_version: listing.terms_version,
      mediaCount: media?.length ?? 0,
      hasConfirmedPassport: false,
    });
    if (!eligibility.eligible) throw new Error(`This listing is not eligible: ${eligibility.reason}.`);

    // Hash the real photo bytes so the metadata fingerprint is verifiable.
    const images: { url: string; sha256: string }[] = [];
    for (const item of media ?? []) {
      if (!item.storage_path) continue;
      const { data: file, error: downloadError } = await db.storage
        .from(METADATA_BUCKET)
        .download(item.storage_path);
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

    const frozenAt = new Date().toISOString();
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
      termsVersion: listing.terms_version ?? "",
      sellerHandle: profile?.handle ?? "",
      images,
      frozenAt,
    });

    const canonical = canonicalJson(metadata);
    const metadataHash = keccak256(toBytes(canonical));
    const termsHash = keccak256(
      toBytes(`YARD SALE Item Passport Terms ${listing.terms_version}\n${metadata.disclaimer}`),
    );
    const listingKey = keccak256(toBytes(listing.id));

    const path = `passports/${listing.id}.json`;
    const { error: uploadError } = await db.storage
      .from(METADATA_BUCKET)
      .upload(path, new Blob([canonical], { type: "application/json" }), {
        upsert: true,
        contentType: "application/json",
      });
    if (uploadError) throw new Error(`Metadata upload failed: ${uploadError.message}`);
    // The bucket is private (public buckets are blocked for this workspace), so the
    // passport points at a long-lived signed URL. The metadata hash below is what
    // makes the content verifiable, not the URL.
    const { data: signed, error: signError } = await db.storage
      .from(METADATA_BUCKET)
      .createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
    if (signError || !signed?.signedUrl) {
      throw new Error(`Metadata URL could not be created: ${signError?.message ?? "unknown error"}`);
    }
    const metadataUri = signed.signedUrl;

    const row = {
      listing_id: listing.id,
      user_id: context.userId,
      chain_id: config.chainId,
      contract_address: config.registry.toLowerCase(),
      wallet_address: "",
      metadata_uri: metadataUri,
      metadata_hash: metadataHash,
      terms_hash: termsHash,
      listing_key: listingKey,
      image_hashes: images,
      metadata_snapshot: metadata,
      status: "frozen" as const,
      failure_reason: null,
      tx_hash: null,
    };

    const { data: saved, error: saveError } = existing
      ? await db.from("item_passports").update(row).eq("id", existing.id).select("*").single()
      : await db.from("item_passports").insert(row).select("*").single();
    if (saveError) throw new Error(saveError.message);
    return saved;
  });

/* --------------------------------------------------------- mint submission */

export const recordMintSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { listingId: string; txHash: string; wallet: string }) => {
    if (!isTxHash(input.txHash)) throw new Error("Invalid transaction hash.");
    if (!/^0x[a-fA-F0-9]{40}$/.test(input.wallet)) throw new Error("Invalid wallet address.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const db = await admin();
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
  .inputValidator((input: { listingId: string }) => input)
  .handler(async ({ data, context }) => {
    const config = requireChainConfig();
    const db = await admin();
    const { decodeEventLog, getAddress } = await import("viem");
    const client = await publicClient();

    const { data: passport } = await db
      .from("item_passports")
      .select("*")
      .eq("listing_id", data.listingId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!passport) throw new Error("No passport record for this listing.");
    if (passport.status === "confirmed") return passport;
    if (!passport.tx_hash) throw new Error("No mint transaction has been submitted yet.");

    const receipt = await client.waitForTransactionReceipt({
      hash: passport.tx_hash as `0x${string}`,
      timeout: 90_000,
    });

    if (receipt.status !== "success") {
      const { data: failed } = await db
        .from("item_passports")
        .update({ status: "failed", failure_reason: "The mint transaction reverted on-chain." })
        .eq("id", passport.id)
        .select("*")
        .single();
      return failed;
    }

    const registry = getAddress(config.registry);
    let minted: { tokenId: bigint; owner: string; listingId: string; metadataHash: string; termsHash: string } | null =
      null;
    for (const log of receipt.logs) {
      if (getAddress(log.address) !== registry) continue;
      try {
        const decoded = decodeEventLog({ abi: assetRegistryAbi, data: log.data, topics: log.topics });
        if (decoded.eventName !== "PassportMinted") continue;
        const args = decoded.args as unknown as {
          tokenId: bigint;
          owner: string;
          listingId: string;
          metadataHash: string;
          termsHash: string;
        };
        minted = args;
        break;
      } catch {
        continue;
      }
    }
    if (!minted) throw new Error("The transaction succeeded but no PassportMinted event was found. Nothing was saved.");
    if (minted.listingId.toLowerCase() !== passport.listing_key.toLowerCase()) {
      throw new Error("The mint event refers to a different listing. Nothing was saved.");
    }
    if (minted.metadataHash.toLowerCase() !== passport.metadata_hash.toLowerCase()) {
      throw new Error("On-chain metadata fingerprint does not match the frozen metadata. Nothing was saved.");
    }
    if (minted.termsHash.toLowerCase() !== passport.terms_hash.toLowerCase()) {
      throw new Error("On-chain terms fingerprint does not match. Nothing was saved.");
    }

    const onChainOwner = await client.readContract({
      address: registry,
      abi: assetRegistryAbi,
      functionName: "ownerOf",
      args: [minted.tokenId],
    });
    if (getAddress(onChainOwner) !== getAddress(minted.owner)) {
      throw new Error("Passport owner could not be confirmed on-chain. Nothing was saved.");
    }

    const { data: confirmed, error } = await db
      .from("item_passports")
      .update({
        status: "confirmed",
        token_id: minted.tokenId.toString() as unknown as number,
        wallet_address: minted.owner.toLowerCase(),
        block_number: Number(receipt.blockNumber),
        confirmed_at: new Date().toISOString(),
        failure_reason: null,
      })
      .eq("id", passport.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await db.from("listings").update({ passport_minted: true }).eq("id", passport.listing_id);
    return confirmed;
  });

/* -------------------------------------------------- companion token creation */

export const recordTokenSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      listingId: string;
      txHash: string;
      wallet: string;
      name: string;
      symbol: string;
      totalSupply: string;
      creatorAllocation: string;
      disclaimerAccepted: boolean;
    }) => {
      if (!isTxHash(input.txHash)) throw new Error("Invalid transaction hash.");
      if (!/^0x[a-fA-F0-9]{40}$/.test(input.wallet)) throw new Error("Invalid wallet address.");
      if (!input.disclaimerAccepted) throw new Error("The no-rights acknowledgement is required.");
      if (!input.name.trim() || !input.symbol.trim()) throw new Error("Name and symbol are required.");
      if (!/^\d+$/.test(input.totalSupply) || BigInt(input.totalSupply) <= 0n) {
        throw new Error("Total supply must be a positive whole number.");
      }
      if (!/^\d+$/.test(input.creatorAllocation) || BigInt(input.creatorAllocation) <= 0n) {
        throw new Error("Your allocation must be a positive whole number.");
      }
      if (BigInt(input.creatorAllocation) > BigInt(input.totalSupply)) {
        throw new Error("Your allocation cannot exceed the total supply.");
      }
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const config = requireChainConfig();
    if (!config.factory) throw new Error("Missing configuration: VITE_TOKEN_FACTORY_ADDRESS.");
    const db = await admin();

    const { data: passport } = await db
      .from("item_passports")
      .select("*")
      .eq("listing_id", data.listingId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!passport || passport.status !== "confirmed") {
      throw new Error("Mint and confirm the Item Passport before creating a companion token.");
    }

    const { data: existing } = await db
      .from("companion_tokens")
      .select("*")
      .eq("passport_id", passport.id)
      .maybeSingle();
    if (existing?.status === "confirmed") throw new Error("This passport already has a companion token.");
    if (existing?.status === "submitted" && existing.tx_hash && existing.tx_hash !== data.txHash) {
      throw new Error("Another companion token transaction is already pending for this passport.");
    }

    const row = {
      passport_id: passport.id,
      listing_id: passport.listing_id,
      user_id: context.userId,
      chain_id: config.chainId,
      factory_address: config.factory.toLowerCase(),
      wallet_address: data.wallet.toLowerCase(),
      name: data.name.trim(),
      symbol: data.symbol.trim().toUpperCase(),
      total_supply: data.totalSupply as unknown as number,
      creator_allocation: data.creatorAllocation as unknown as number,
      tx_hash: data.txHash,
      status: "submitted" as const,
      failure_reason: null,
      disclaimer_accepted_at: new Date().toISOString(),
    };

    const { data: saved, error } = existing
      ? await db.from("companion_tokens").update(row).eq("id", existing.id).select("*").single()
      : await db.from("companion_tokens").insert(row).select("*").single();
    if (error) throw new Error(error.message);
    return saved;
  });

export const reconcileCompanionToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { listingId: string }) => input)
  .handler(async ({ data, context }) => {
    const config = requireChainConfig();
    const db = await admin();
    const { decodeEventLog, getAddress } = await import("viem");
    const client = await publicClient();

    const { data: token } = await db
      .from("companion_tokens")
      .select("*")
      .eq("listing_id", data.listingId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!token) throw new Error("No companion token record for this listing.");
    if (token.status === "confirmed") return token;
    if (!token.tx_hash) throw new Error("No companion token transaction has been submitted yet.");

    const receipt = await client.waitForTransactionReceipt({
      hash: token.tx_hash as `0x${string}`,
      timeout: 90_000,
    });
    if (receipt.status !== "success") {
      const { data: failed } = await db
        .from("companion_tokens")
        .update({ status: "failed", failure_reason: "The token deployment transaction reverted on-chain." })
        .eq("id", token.id)
        .select("*")
        .single();
      return failed;
    }

    const factory = getAddress(config.factory);
    type CreatedEvent = {
      passportTokenId: bigint;
      token: string;
      creator: string;
      totalSupply: bigint;
      creatorAllocation: bigint;
    };
    let created: CreatedEvent | null = null;
    for (const log of receipt.logs) {
      if (getAddress(log.address) !== factory) continue;
      try {
        const decoded = decodeEventLog({ abi: tokenFactoryAbi, data: log.data, topics: log.topics });
        if (decoded.eventName !== "CompanionTokenCreated") continue;
        created = decoded.args as unknown as CreatedEvent;
        break;
      } catch {
        continue;
      }
    }
    if (!created) throw new Error("No CompanionTokenCreated event was found in that transaction. Nothing was saved.");

    const { data: passport } = await db.from("item_passports").select("*").eq("id", token.passport_id).single();
    if (!passport?.token_id || created.passportTokenId.toString() !== String(passport.token_id)) {
      throw new Error("The token was created for a different passport. Nothing was saved.");
    }

    // Verify real deployed bytecode and the exact supply split.
    const bytecode = await client.getCode({ address: getAddress(created.token) });
    if (!bytecode || bytecode === "0x") throw new Error("No contract code at the token address. Nothing was saved.");

    const [totalSupply, creatorBalance, pairedTokenId, pairedOnRegistry] = await Promise.all([
      client.readContract({ address: getAddress(created.token), abi: companionTokenAbi, functionName: "totalSupply" }),
      client.readContract({
        address: getAddress(created.token),
        abi: companionTokenAbi,
        functionName: "balanceOf",
        args: [getAddress(created.creator)],
      }),
      client.readContract({
        address: getAddress(created.token),
        abi: companionTokenAbi,
        functionName: "passportTokenId",
      }),
      client.readContract({
        address: getAddress(config.registry),
        abi: assetRegistryAbi,
        functionName: "companionTokenOf",
        args: [BigInt(String(passport.token_id))],
      }),
    ]);

    if (totalSupply !== BigInt(String(token.total_supply))) {
      throw new Error("On-chain total supply does not match what you submitted. Nothing was saved.");
    }
    if (creatorBalance !== BigInt(String(token.creator_allocation))) {
      throw new Error("On-chain creator allocation does not match what you submitted. Nothing was saved.");
    }
    if (pairedTokenId.toString() !== String(passport.token_id)) {
      throw new Error("The token is not bound to this passport. Nothing was saved.");
    }
    if (getAddress(pairedOnRegistry) !== getAddress(created.token)) {
      throw new Error("The registry is not paired with this token. Nothing was saved.");
    }

    const { data: confirmed, error } = await db
      .from("companion_tokens")
      .update({
        status: "confirmed",
        token_address: created.token.toLowerCase(),
        block_number: Number(receipt.blockNumber),
        confirmed_at: new Date().toISOString(),
        failure_reason: null,
      })
      .eq("id", token.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await db.from("listings").update({ companion_token: true }).eq("id", token.listing_id);
    return confirmed;
  });

export const launchpadDisclaimer = COMPANION_TOKEN_DISCLAIMER;
