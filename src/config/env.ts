/**
 * Validated public configuration for YARD SALE.
 * Server-only secrets are never read here.
 */

const raw = import.meta.env as Record<string, string | undefined>;

function str(key: string, fallback = ""): string {
  const value = raw[key];
  return value && value.length > 0 ? value : fallback;
}

function bool(key: string): boolean {
  return str(key).toLowerCase() === "true";
}

export const ROBINHOOD_MAINNET_ID = 4663;
export const ROBINHOOD_TESTNET_ID = 46630;

export const SUPPORTED_CHAIN_IDS = [ROBINHOOD_MAINNET_ID, ROBINHOOD_TESTNET_ID] as const;

const requestedChainId = Number(str("VITE_DEFAULT_CHAIN_ID", String(ROBINHOOD_TESTNET_ID)));
const enableMainnet = bool("VITE_ENABLE_MAINNET");

export const publicEnv = {
  appUrl: str("VITE_APP_URL", typeof window !== "undefined" ? window.location.origin : ""),
  /** The chain the operator asked for. May differ from `activeChainId` when mainnet is not enabled. */
  requestedChainId,
  /** The chain the app actually uses for reads and writes. Mainnet only when explicitly enabled. */
  activeChainId:
    requestedChainId === ROBINHOOD_MAINNET_ID && enableMainnet ? ROBINHOOD_MAINNET_ID : ROBINHOOD_TESTNET_ID,
  defaultChainId: requestedChainId,
  enableMainnet,
  mainnetRpcUrl: str("VITE_ROBINHOOD_MAINNET_RPC_URL", "https://rpc.mainnet.chain.robinhood.com"),
  testnetRpcUrl: str("VITE_ROBINHOOD_TESTNET_RPC_URL", "https://rpc.testnet.chain.robinhood.com"),
  walletConnectProjectId: str("VITE_WALLETCONNECT_PROJECT_ID"),
  assetRegistryAddress: str("VITE_ASSET_REGISTRY_ADDRESS"),
  tokenFactoryAddress: str("VITE_TOKEN_FACTORY_ADDRESS"),
  /** Optional: the administrator address that must hold DEFAULT_ADMIN_ROLE on both contracts. Required on mainnet. */
  expectedAdminAddress: str("VITE_EXPECTED_ADMIN_ADDRESS"),
  escrowAddress: str("VITE_ESCROW_ADDRESS"),
  liquidityLockerAddress: str("VITE_LIQUIDITY_LOCKER_ADDRESS"),
  ipfsGateway: str("VITE_IPFS_GATEWAY", "https://ipfs.io/ipfs/"),
} as const;

export const isSupportedChainId = (id: number): id is (typeof SUPPORTED_CHAIN_IDS)[number] =>
  SUPPORTED_CHAIN_IDS.includes(id as (typeof SUPPORTED_CHAIN_IDS)[number]);

export const isHexAddress = (value: string): value is `0x${string}` => /^0x[a-fA-F0-9]{40}$/.test(value);

/** Mainnet was requested by configuration but writes are still switched off. */
export const mainnetRequestedButDisabled = () =>
  publicEnv.requestedChainId === ROBINHOOD_MAINNET_ID && !publicEnv.enableMainnet;

export type ConfigCheck = {
  key: string;
  label: string;
  ready: boolean;
  detail: string;
};

export function configChecks(): ConfigCheck[] {
  const onMainnet = publicEnv.activeChainId === ROBINHOOD_MAINNET_ID;
  return [
    {
      key: "network",
      label: "Active network",
      ready: true,
      detail: onMainnet
        ? "Robinhood Chain mainnet (4663)"
        : mainnetRequestedButDisabled()
          ? "Robinhood Chain testnet (46630) — mainnet was requested (VITE_DEFAULT_CHAIN_ID=4663) but VITE_ENABLE_MAINNET is not true"
          : "Robinhood Chain testnet (46630)",
    },
    {
      key: "mainnet",
      label: "Mainnet writes",
      ready: publicEnv.enableMainnet,
      detail: publicEnv.enableMainnet
        ? "Enabled by configuration — still subject to the live deployment checks below"
        : "Disabled until the deployed contracts pass every live check and VITE_ENABLE_MAINNET=true",
    },
    {
      key: "registry",
      label: "Item Passport registry contract",
      ready: isHexAddress(publicEnv.assetRegistryAddress),
      detail: publicEnv.assetRegistryAddress
        ? isHexAddress(publicEnv.assetRegistryAddress)
          ? publicEnv.assetRegistryAddress
          : `VITE_ASSET_REGISTRY_ADDRESS is not a valid address: ${publicEnv.assetRegistryAddress}`
        : "VITE_ASSET_REGISTRY_ADDRESS not set",
    },
    {
      key: "factory",
      label: "Companion token factory",
      ready: isHexAddress(publicEnv.tokenFactoryAddress),
      detail: publicEnv.tokenFactoryAddress
        ? isHexAddress(publicEnv.tokenFactoryAddress)
          ? publicEnv.tokenFactoryAddress
          : `VITE_TOKEN_FACTORY_ADDRESS is not a valid address: ${publicEnv.tokenFactoryAddress}`
        : "VITE_TOKEN_FACTORY_ADDRESS not set",
    },
    {
      key: "admin",
      label: "Expected administrator",
      ready: isHexAddress(publicEnv.expectedAdminAddress),
      detail: isHexAddress(publicEnv.expectedAdminAddress)
        ? publicEnv.expectedAdminAddress
        : onMainnet
          ? "VITE_EXPECTED_ADMIN_ADDRESS not set — required on mainnet so the admin role can be verified"
          : "VITE_EXPECTED_ADMIN_ADDRESS not set (optional on testnet)",
    },
    {
      key: "escrow",
      label: "Escrow contract",
      ready: Boolean(publicEnv.escrowAddress),
      detail: publicEnv.escrowAddress || "VITE_ESCROW_ADDRESS not set — on-chain purchases stay disabled",
    },
    {
      key: "locker",
      label: "Liquidity locker",
      ready: Boolean(publicEnv.liquidityLockerAddress),
      detail: publicEnv.liquidityLockerAddress || "VITE_LIQUIDITY_LOCKER_ADDRESS not set — liquidity locking stays disabled",
    },
    {
      key: "walletconnect",
      label: "WalletConnect",
      ready: Boolean(publicEnv.walletConnectProjectId),
      detail: publicEnv.walletConnectProjectId
        ? "Project ID configured"
        : "Optional. Injected browser wallets still work.",
    },
  ];
}

export const chainWritesReady = () =>
  isHexAddress(publicEnv.assetRegistryAddress) && isHexAddress(publicEnv.tokenFactoryAddress);
