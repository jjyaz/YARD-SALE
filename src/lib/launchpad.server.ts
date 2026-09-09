/**
 * Server-only helpers for the launchpad: live deployment validation, IPFS pinning,
 * and the shared RPC client. Never imported by browser code (blocked by filename).
 */
import {
  createPublicClient,
  getAddress,
  http,
  keccak256,
  toBytes,
  zeroAddress,
  type PublicClient,
} from "viem";

import {
  isHexAddress,
  publicEnv,
  ROBINHOOD_MAINNET_ID,
  ROBINHOOD_TESTNET_ID,
  isSupportedChainId,
} from "@/config/env";
import {
  assetRegistryAbi,
  companionTokenAbi,
  ERC721_INTERFACE_ID,
  tokenFactoryAbi,
} from "@/lib/abi";
import { chainById, uniswapMainnet, UNISWAP_FEE_TIER, UNISWAP_TICK_SPACING } from "@/lib/chain";
import { nonfungiblePositionManagerAbi, uniswapV3FactoryAbi, weth9Abi } from "@/lib/uniswap-abi";

export type HealthCheck = {
  key: string;
  label: string;
  ok: boolean;
  /** Blockers disable writes. Warnings are shown but do not block. */
  severity: "blocker" | "warning";
  detail: string;
};

export type DeploymentHealth = {
  chainId: number;
  chainName: string;
  rpcUrl: string;
  registry: string | null;
  factory: string | null;
  implementation: string | null;
  treasury: string | null;
  totalMinted: string | null;
  mainnetEnabled: boolean;
  mainnetRequested: boolean;
  /** True only when every blocker passes. */
  ready: boolean;
  checks: HealthCheck[];
  checkedAt: string;
};

const ROLE = {
  admin: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
  pairing: keccak256(toBytes("PAIRING_ROLE")),
  pauser: keccak256(toBytes("PAUSER_ROLE")),
};

export function rpcClient(chainId: number = publicEnv.activeChainId): PublicClient {
  const chain = chainById(chainId);
  return createPublicClient({
    chain,
    transport: http(chain.rpcUrls.default.http[0], { timeout: 20_000 }),
  });
}

const cache = new Map<string, { at: number; value: DeploymentHealth }>();
const CACHE_MS = 30_000;

/**
 * Validates the configured registry/factory against live chain state.
 * Every failure names the exact missing or wrong configuration.
 */
export async function verifyDeployment(
  options: { force?: boolean } = {},
): Promise<DeploymentHealth> {
  const chainId = publicEnv.activeChainId;
  const chain = chainById(chainId);
  const registryEnv = publicEnv.assetRegistryAddress;
  const factoryEnv = publicEnv.tokenFactoryAddress;
  const cacheKey = `${chainId}:${registryEnv}:${factoryEnv}:${publicEnv.expectedAdminAddress}`;
  const hit = cache.get(cacheKey);
  if (!options.force && hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const checks: HealthCheck[] = [];
  const push = (
    key: string,
    label: string,
    ok: boolean,
    detail: string,
    severity: HealthCheck["severity"] = "blocker",
  ) => checks.push({ key, label, ok, detail, severity });

  const base: Omit<DeploymentHealth, "ready" | "checks" | "checkedAt"> = {
    chainId,
    chainName: chain.name,
    rpcUrl: chain.rpcUrls.default.http[0],
    registry: isHexAddress(registryEnv) ? getAddress(registryEnv) : null,
    factory: isHexAddress(factoryEnv) ? getAddress(factoryEnv) : null,
    implementation: null,
    treasury: null,
    totalMinted: null,
    mainnetEnabled: publicEnv.enableMainnet,
    mainnetRequested: publicEnv.requestedChainId === ROBINHOOD_MAINNET_ID,
  };

  const finish = (): DeploymentHealth => {
    const value: DeploymentHealth = {
      ...base,
      checks,
      ready: checks.every((c) => c.ok || c.severity === "warning"),
      checkedAt: new Date().toISOString(),
    };
    cache.set(cacheKey, { at: Date.now(), value });
    return value;
  };

  // --- configuration -------------------------------------------------------
  if (!isSupportedChainId(chainId)) {
    push(
      "chain.supported",
      "Supported chain",
      false,
      `Chain ${chainId} is not supported. Use 4663 (mainnet) or 46630 (testnet).`,
    );
    return finish();
  }
  if (base.mainnetRequested && !publicEnv.enableMainnet) {
    push(
      "mainnet.enabled",
      "Mainnet writes",
      false,
      "VITE_DEFAULT_CHAIN_ID=4663 is set but VITE_ENABLE_MAINNET is not true, so the app is running against testnet (46630). Set VITE_ENABLE_MAINNET=true only after every check below is green on mainnet.",
      "warning",
    );
  }
  if (!isHexAddress(registryEnv)) {
    push(
      "env.registry",
      "Registry address",
      false,
      registryEnv
        ? `VITE_ASSET_REGISTRY_ADDRESS is not a valid address (${registryEnv}).`
        : "VITE_ASSET_REGISTRY_ADDRESS is not set.",
    );
  } else push("env.registry", "Registry address", true, getAddress(registryEnv));
  if (!isHexAddress(factoryEnv)) {
    push(
      "env.factory",
      "Factory address",
      false,
      factoryEnv
        ? `VITE_TOKEN_FACTORY_ADDRESS is not a valid address (${factoryEnv}).`
        : "VITE_TOKEN_FACTORY_ADDRESS is not set.",
    );
  } else push("env.factory", "Factory address", true, getAddress(factoryEnv));
  if (!isHexAddress(registryEnv) || !isHexAddress(factoryEnv)) return finish();

  const registry = getAddress(registryEnv);
  const factory = getAddress(factoryEnv);
  if (registry === factory) {
    push(
      "env.distinct",
      "Distinct contracts",
      false,
      "Registry and factory are the same address. That is not a valid deployment.",
    );
    return finish();
  }
  push("env.distinct", "Distinct contracts", true, "Registry and factory are different contracts.");

  // --- RPC + chain id ------------------------------------------------------
  const client = rpcClient(chainId);
  let liveChainId: number;
  try {
    liveChainId = await client.getChainId();
  } catch (error) {
    push(
      "rpc.reachable",
      "RPC reachable",
      false,
      `Could not reach ${base.rpcUrl}: ${(error as Error).message}`,
    );
    return finish();
  }
  if (liveChainId !== chainId) {
    push(
      "rpc.chain",
      "RPC chain id",
      false,
      `The RPC at ${base.rpcUrl} reports chain ${liveChainId}, expected ${chainId}. Fix ${
        chainId === ROBINHOOD_MAINNET_ID
          ? "VITE_ROBINHOOD_MAINNET_RPC_URL"
          : "VITE_ROBINHOOD_TESTNET_RPC_URL"
      }.`,
    );
    return finish();
  }
  push("rpc.chain", "RPC chain id", true, `${chain.name} (${liveChainId}) via ${base.rpcUrl}`);

  // --- bytecode ------------------------------------------------------------
  const [registryCode, factoryCode] = await Promise.all([
    client.getCode({ address: registry }),
    client.getCode({ address: factory }),
  ]);
  const hasCode = (code: string | undefined) => Boolean(code && code !== "0x");
  push(
    "registry.code",
    "Registry bytecode",
    hasCode(registryCode),
    hasCode(registryCode)
      ? `${(registryCode!.length - 2) / 2} bytes`
      : `No contract code at ${registry} on chain ${chainId}. Wrong address or wrong network.`,
  );
  push(
    "factory.code",
    "Factory bytecode",
    hasCode(factoryCode),
    hasCode(factoryCode)
      ? `${(factoryCode!.length - 2) / 2} bytes`
      : `No contract code at ${factory} on chain ${chainId}. Wrong address or wrong network.`,
  );
  if (!hasCode(registryCode) || !hasCode(factoryCode)) return finish();

  // --- interfaces ----------------------------------------------------------
  try {
    const [isErc721, pairingRole, totalMinted, registryPaused] = await Promise.all([
      client.readContract({
        address: registry,
        abi: assetRegistryAbi,
        functionName: "supportsInterface",
        args: [ERC721_INTERFACE_ID],
      }),
      client.readContract({
        address: registry,
        abi: assetRegistryAbi,
        functionName: "PAIRING_ROLE",
      }),
      client.readContract({
        address: registry,
        abi: assetRegistryAbi,
        functionName: "totalMinted",
      }),
      client.readContract({ address: registry, abi: assetRegistryAbi, functionName: "paused" }),
    ]);
    base.totalMinted = totalMinted.toString();
    const ok = isErc721 && pairingRole.toLowerCase() === ROLE.pairing.toLowerCase();
    push(
      "registry.interface",
      "Registry interface",
      ok,
      ok
        ? `ERC-721 + YardSaleAssetRegistry roles, ${totalMinted.toString()} passports minted`
        : "The contract at the registry address does not expose the YardSaleAssetRegistry interface.",
    );
    push(
      "registry.paused",
      "Registry not paused",
      !registryPaused,
      registryPaused
        ? "The registry is paused by its administrator. Minting is disabled until it is unpaused."
        : "Active",
    );
  } catch (error) {
    push(
      "registry.interface",
      "Registry interface",
      false,
      `Registry calls reverted: ${(error as Error).message.split("\n")[0]}`,
    );
    return finish();
  }

  let implementation: `0x${string}`;
  try {
    const [pauserRole, linkedRegistry, impl, treasury, factoryPaused] = await Promise.all([
      client.readContract({ address: factory, abi: tokenFactoryAbi, functionName: "PAUSER_ROLE" }),
      client.readContract({ address: factory, abi: tokenFactoryAbi, functionName: "registry" }),
      client.readContract({
        address: factory,
        abi: tokenFactoryAbi,
        functionName: "implementation",
      }),
      client.readContract({ address: factory, abi: tokenFactoryAbi, functionName: "treasury" }),
      client.readContract({ address: factory, abi: tokenFactoryAbi, functionName: "paused" }),
    ]);
    implementation = getAddress(impl);
    base.implementation = implementation;
    base.treasury = getAddress(treasury);
    const ok = pauserRole.toLowerCase() === ROLE.pauser.toLowerCase();
    push(
      "factory.interface",
      "Factory interface",
      ok,
      ok
        ? "YardTokenFactory roles and pointers readable"
        : "The contract at the factory address does not expose the YardTokenFactory interface.",
    );
    push(
      "link.registry",
      "Factory → registry pointer",
      getAddress(linkedRegistry) === registry,
      getAddress(linkedRegistry) === registry
        ? "factory.registry() matches VITE_ASSET_REGISTRY_ADDRESS"
        : `factory.registry() is ${getAddress(linkedRegistry)}, not ${registry}. These contracts were not deployed together.`,
    );
    push(
      "factory.paused",
      "Factory not paused",
      !factoryPaused,
      factoryPaused
        ? "The factory is paused by its administrator. Token launches are disabled until it is unpaused."
        : "Active",
    );
    push(
      "factory.treasury",
      "Treasury address",
      base.treasury !== zeroAddress,
      base.treasury !== zeroAddress ? base.treasury : "Treasury is the zero address.",
    );
  } catch (error) {
    push(
      "factory.interface",
      "Factory interface",
      false,
      `Factory calls reverted: ${(error as Error).message.split("\n")[0]}`,
    );
    return finish();
  }

  // --- registry ↔ factory relationship + implementation --------------------
  try {
    const [pairingGranted, implCode] = await Promise.all([
      client.readContract({
        address: registry,
        abi: assetRegistryAbi,
        functionName: "hasRole",
        args: [ROLE.pairing, factory],
      }),
      client.getCode({ address: implementation }),
    ]);
    push(
      "link.pairing",
      "Factory holds PAIRING_ROLE",
      pairingGranted,
      pairingGranted
        ? "registry.hasRole(PAIRING_ROLE, factory) = true"
        : "The registry has not granted PAIRING_ROLE to the factory. Token pairing would revert.",
    );
    const implOk = hasCode(implCode) && implementation !== registry && implementation !== factory;
    push(
      "impl.code",
      "Token implementation bytecode",
      implOk,
      implOk
        ? `${implementation} (${(implCode!.length - 2) / 2} bytes)`
        : "factory.implementation() has no code or collides with another contract.",
    );
    if (implOk) {
      const [implCreator, implSupply, implFactory] = await Promise.all([
        client.readContract({
          address: implementation,
          abi: companionTokenAbi,
          functionName: "creator",
        }),
        client.readContract({
          address: implementation,
          abi: companionTokenAbi,
          functionName: "totalSupply",
        }),
        client.readContract({
          address: implementation,
          abi: companionTokenAbi,
          functionName: "factory",
        }),
      ]);
      const locked =
        implCreator === zeroAddress && implSupply === 0n && implFactory === zeroAddress;
      push(
        "impl.locked",
        "Implementation never initialised",
        locked,
        locked
          ? "creator = 0x0, totalSupply = 0, factory = 0x0"
          : "The implementation contract has been initialised. It must be a bare, locked template.",
      );
    }
  } catch (error) {
    push(
      "link.pairing",
      "Factory holds PAIRING_ROLE",
      false,
      `Relationship check failed: ${(error as Error).message.split("\n")[0]}`,
    );
  }

  // --- administrator -------------------------------------------------------
  const expectedAdmin = publicEnv.expectedAdminAddress;
  if (isHexAddress(expectedAdmin)) {
    const admin = getAddress(expectedAdmin);
    const [regAdmin, facAdmin] = await Promise.all([
      client.readContract({
        address: registry,
        abi: assetRegistryAbi,
        functionName: "hasRole",
        args: [ROLE.admin, admin],
      }),
      client.readContract({
        address: factory,
        abi: tokenFactoryAbi,
        functionName: "hasRole",
        args: [ROLE.admin, admin],
      }),
    ]);
    push(
      "admin.roles",
      "Expected administrator",
      regAdmin && facAdmin,
      regAdmin && facAdmin
        ? `${admin} holds DEFAULT_ADMIN_ROLE on both contracts`
        : `${admin} is missing DEFAULT_ADMIN_ROLE on ${!regAdmin ? "the registry" : ""}${!regAdmin && !facAdmin ? " and " : ""}${!facAdmin ? "the factory" : ""}.`,
    );
  } else {
    const onMainnet = chainId === ROBINHOOD_MAINNET_ID;
    push(
      "admin.roles",
      "Expected administrator",
      false,
      onMainnet
        ? "VITE_EXPECTED_ADMIN_ADDRESS is not set. On mainnet the administrator role must be verified before writes are enabled."
        : "VITE_EXPECTED_ADMIN_ADDRESS is not set, so the administrator role was not verified (optional on testnet).",
      onMainnet ? "blocker" : "warning",
    );
  }

  // --- platform mint signer ------------------------------------------------
  // Passports can only be minted with an EIP-712 voucher signed by an address holding
  // SIGNER_ROLE. Without it, nobody can mint — and nobody can front-run someone else's listing.
  try {
    const { platformSignerAddress, signerStatus } = await import("@/lib/passport-voucher.server");
    const status = signerStatus();
    if (!status.configured) {
      push(
        "signer.configured",
        "Platform mint signer",
        false,
        `${status.missing} is not set. Item Passport minting requires a platform-signed authorisation, so minting stays disabled until the signing key is configured.`,
      );
    } else {
      const signer = await platformSignerAddress();
      const signerRole = keccak256(toBytes("SIGNER_ROLE"));
      const granted = await client.readContract({
        address: registry,
        abi: assetRegistryAbi,
        functionName: "hasRole",
        args: [signerRole, signer],
      });
      push(
        "signer.configured",
        "Platform mint signer",
        granted,
        granted
          ? `${signer} holds SIGNER_ROLE on the registry`
          : `${signer} does not hold SIGNER_ROLE on the registry. The administrator must grant it before any passport can be minted.`,
      );
    }
  } catch (error) {
    push(
      "signer.configured",
      "Platform mint signer",
      false,
      `Signer check failed: ${(error as Error).message.split("\n")[0]}`,
    );
  }

  return finish();
}

/** Throws a precise error when writes are not allowed. Returns the verified addresses otherwise. */
export async function requireVerifiedDeployment() {
  const health = await verifyDeployment();
  const blocker = health.checks.find((c) => !c.ok && c.severity === "blocker");
  if (blocker) throw new Error(`${blocker.label}: ${blocker.detail}`);
  if (health.chainId === ROBINHOOD_MAINNET_ID && !publicEnv.enableMainnet) {
    throw new Error("Mainnet writes are disabled (VITE_ENABLE_MAINNET is not true).");
  }
  return {
    chainId: health.chainId,
    registry: health.registry as `0x${string}`,
    factory: health.factory as `0x${string}`,
    implementation: health.implementation as `0x${string}`,
  };
}

/* ------------------------------------------------------------------- IPFS */

export type PinResult =
  | { pinned: true; cid: string; provider: "pinata"; verifiedBy: "cid" | "gateway" }
  | { pinned: false; cid: null; missing: string; provider: null };

export function ipfsPinningStatus(): {
  configured: boolean;
  missing: string | null;
  provider: string | null;
} {
  const jwt = process.env["PINATA_JWT"];
  return jwt
    ? { configured: true, missing: null, provider: "pinata" }
    : { configured: false, missing: "PINATA_JWT", provider: null };
}

const DEFAULT_IPFS_READ_GATEWAY = "https://gateway.pinata.cloud/ipfs/";

/**
 * Pins arbitrary bytes to IPFS via Pinata when a JWT is configured. Never fakes a CID.
 * The returned CID is only trusted when it equals the locally computed CIDv1 (raw, sha2-256)
 * or when the bytes served for that CID are byte-identical to what was pinned.
 */
export async function pinBytesToIpfs(
  bytes: Uint8Array,
  name: string,
  contentType: string,
): Promise<PinResult> {
  const jwt = process.env["PINATA_JWT"];
  if (!jwt) return { pinned: false, cid: null, missing: "PINATA_JWT", provider: null };

  const { cidV1Raw } = await import("@/lib/ipfs");
  const expectedCid = await cidV1Raw(bytes);

  const body = new Uint8Array(bytes);
  const form = new FormData();
  form.append("file", new Blob([body], { type: contentType }), name);
  form.append("pinataMetadata", JSON.stringify({ name }));
  form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));

  const response = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `IPFS pinning failed (${response.status}): ${text.slice(0, 200) || response.statusText}`,
    );
  }
  const json = (await response.json()) as { IpfsHash?: string };
  const cid = json.IpfsHash?.trim();
  if (!cid) throw new Error("IPFS pinning service did not return a content ID.");
  if (cid === expectedCid) return { pinned: true, cid, provider: "pinata", verifiedBy: "cid" };

  // Different chunking/codec (e.g. dag-pb wrapped) can legitimately produce another CID.
  // Only accept it after reading the bytes back and confirming they are identical.
  const gateway = (process.env["IPFS_READ_GATEWAY"] ?? DEFAULT_IPFS_READ_GATEWAY).replace(
    /\/?$/,
    "/",
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const read = await fetch(`${gateway}${cid}`, {
      signal: controller.signal,
      headers: { Accept: "*/*" },
    });
    if (!read.ok) throw new Error(`gateway responded ${read.status}`);
    const served = new Uint8Array(await read.arrayBuffer());
    const identical = served.length === bytes.length && served.every((b, i) => b === bytes[i]);
    if (!identical) throw new Error("served bytes differ from what was pinned");
    return { pinned: true, cid, provider: "pinata", verifiedBy: "gateway" };
  } catch (error) {
    throw new Error(
      `IPFS pin could not be verified: Pinata returned ${cid} but the locally computed CID is ${expectedCid} and read-back failed (${
        error instanceof Error ? error.message : String(error)
      }). Nothing was frozen with an unverified content ID.`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Pins canonical JSON to IPFS. See {@link pinBytesToIpfs}. */
export async function pinJsonToIpfs(canonical: string, name: string): Promise<PinResult> {
  return pinBytesToIpfs(new TextEncoder().encode(canonical), `${name}.json`, "application/json");
}

/* ---------------------------------------------------------------- Uniswap */

export type LiquidityInfra = {
  chainId: number;
  available: boolean;
  checks: HealthCheck[];
  factory: string;
  positionManager: string;
  weth: string;
  feeTier: number;
  tickSpacing: number;
};

/** Verifies the official Uniswap v3 deployment on Robinhood Chain mainnet before any liquidity step. */
export async function verifyLiquidityInfra(): Promise<LiquidityInfra> {
  const checks: HealthCheck[] = [];
  const push = (key: string, label: string, ok: boolean, detail: string) =>
    checks.push({ key, label, ok, detail, severity: "blocker" });
  const result: LiquidityInfra = {
    chainId: publicEnv.activeChainId,
    available: false,
    checks,
    factory: getAddress(uniswapMainnet.factory),
    positionManager: getAddress(uniswapMainnet.positionManager),
    weth: getAddress(uniswapMainnet.weth),
    feeTier: UNISWAP_FEE_TIER,
    tickSpacing: UNISWAP_TICK_SPACING,
  };

  if (publicEnv.activeChainId !== ROBINHOOD_MAINNET_ID) {
    push(
      "chain",
      "Mainnet only",
      false,
      publicEnv.activeChainId === ROBINHOOD_TESTNET_ID
        ? "There is no official Uniswap deployment on Robinhood Chain testnet. Liquidity launches are available on mainnet (4663) once VITE_ENABLE_MAINNET=true and the deployment checks pass."
        : `Unsupported chain ${publicEnv.activeChainId}.`,
    );
    return result;
  }
  if (!publicEnv.enableMainnet) {
    push("mainnet.enabled", "Mainnet writes", false, "VITE_ENABLE_MAINNET is not true.");
    return result;
  }

  const client = rpcClient(ROBINHOOD_MAINNET_ID);
  try {
    const live = await client.getChainId();
    push(
      "rpc.chain",
      "RPC chain id",
      live === ROBINHOOD_MAINNET_ID,
      live === ROBINHOOD_MAINNET_ID ? "4663" : `RPC reports ${live}, expected 4663.`,
    );
    if (live !== ROBINHOOD_MAINNET_ID) return result;

    const [factoryCode, pmCode, wethCode] = await Promise.all([
      client.getCode({ address: result.factory as `0x${string}` }),
      client.getCode({ address: result.positionManager as `0x${string}` }),
      client.getCode({ address: result.weth as `0x${string}` }),
    ]);
    const hasCode = (c?: string) => Boolean(c && c !== "0x");
    push(
      "factory.code",
      "UniswapV3Factory bytecode",
      hasCode(factoryCode),
      hasCode(factoryCode) ? result.factory : `No code at ${result.factory}.`,
    );
    push(
      "pm.code",
      "NonfungiblePositionManager bytecode",
      hasCode(pmCode),
      hasCode(pmCode) ? result.positionManager : `No code at ${result.positionManager}.`,
    );
    push(
      "weth.code",
      "WETH9 bytecode",
      hasCode(wethCode),
      hasCode(wethCode) ? result.weth : `No code at ${result.weth}.`,
    );
    if (!hasCode(factoryCode) || !hasCode(pmCode) || !hasCode(wethCode)) return result;

    const [pmFactory, pmWeth, spacing, wethSymbol] = await Promise.all([
      client.readContract({
        address: result.positionManager as `0x${string}`,
        abi: nonfungiblePositionManagerAbi,
        functionName: "factory",
      }),
      client.readContract({
        address: result.positionManager as `0x${string}`,
        abi: nonfungiblePositionManagerAbi,
        functionName: "WETH9",
      }),
      client.readContract({
        address: result.factory as `0x${string}`,
        abi: uniswapV3FactoryAbi,
        functionName: "feeAmountTickSpacing",
        args: [UNISWAP_FEE_TIER],
      }),
      client.readContract({
        address: result.weth as `0x${string}`,
        abi: weth9Abi,
        functionName: "symbol",
      }),
    ]);
    push(
      "pm.factory",
      "Position manager → factory",
      getAddress(pmFactory) === result.factory,
      getAddress(pmFactory) === result.factory
        ? "Matches the official factory"
        : `Position manager points at ${pmFactory}.`,
    );
    push(
      "pm.weth",
      "Position manager → WETH9",
      getAddress(pmWeth) === result.weth,
      getAddress(pmWeth) === result.weth
        ? `Canonical WETH (${wethSymbol})`
        : `Position manager uses ${pmWeth}, not the configured WETH.`,
    );
    push(
      "fee.tier",
      "0.3% fee tier enabled",
      Number(spacing) === UNISWAP_TICK_SPACING,
      Number(spacing) === UNISWAP_TICK_SPACING
        ? `Tick spacing ${spacing}`
        : `Fee tier ${UNISWAP_FEE_TIER} has tick spacing ${spacing}, expected ${UNISWAP_TICK_SPACING}.`,
    );
  } catch (error) {
    push(
      "rpc",
      "Uniswap contracts reachable",
      false,
      `Verification failed: ${(error as Error).message.split("\n")[0]}`,
    );
  }

  result.available = checks.every((c) => c.ok);
  return result;
}
