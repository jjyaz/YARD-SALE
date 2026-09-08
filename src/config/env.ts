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

export const publicEnv = {
  appUrl: str("VITE_APP_URL", typeof window !== "undefined" ? window.location.origin : ""),
  defaultChainId: Number(str("VITE_DEFAULT_CHAIN_ID", String(ROBINHOOD_TESTNET_ID))),
  enableMainnet: bool("VITE_ENABLE_MAINNET"),
  mainnetRpcUrl: str("VITE_ROBINHOOD_MAINNET_RPC_URL", "https://rpc.mainnet.chain.robinhood.com"),
  testnetRpcUrl: str("VITE_ROBINHOOD_TESTNET_RPC_URL", "https://rpc.testnet.chain.robinhood.com"),
  walletConnectProjectId: str("VITE_WALLETCONNECT_PROJECT_ID"),
  assetRegistryAddress: str("VITE_ASSET_REGISTRY_ADDRESS"),
  tokenFactoryAddress: str("VITE_TOKEN_FACTORY_ADDRESS"),
  escrowAddress: str("VITE_ESCROW_ADDRESS"),
  liquidityLockerAddress: str("VITE_LIQUIDITY_LOCKER_ADDRESS"),
} as const;

export type ConfigCheck = {
  key: string;
  label: string;
  ready: boolean;
  detail: string;
};

export function configChecks(): ConfigCheck[] {
  return [
    {
      key: "network",
      label: "Selected network",
      ready: true,
      detail:
        publicEnv.defaultChainId === ROBINHOOD_MAINNET_ID
          ? "Robinhood Chain mainnet (4663)"
          : "Robinhood Chain testnet (46630)",
    },
    {
      key: "mainnet",
      label: "Mainnet writes",
      ready: publicEnv.enableMainnet,
      detail: publicEnv.enableMainnet
        ? "Enabled by configuration"
        : "Disabled until contracts are audited and VITE_ENABLE_MAINNET=true",
    },
    {
      key: "registry",
      label: "Item Passport registry contract",
      ready: Boolean(publicEnv.assetRegistryAddress),
      detail: publicEnv.assetRegistryAddress || "VITE_ASSET_REGISTRY_ADDRESS not set",
    },
    {
      key: "factory",
      label: "Companion token factory",
      ready: Boolean(publicEnv.tokenFactoryAddress),
      detail: publicEnv.tokenFactoryAddress || "VITE_TOKEN_FACTORY_ADDRESS not set",
    },
    {
      key: "escrow",
      label: "Escrow contract",
      ready: Boolean(publicEnv.escrowAddress),
      detail: publicEnv.escrowAddress || "VITE_ESCROW_ADDRESS not set",
    },
    {
      key: "locker",
      label: "Liquidity locker",
      ready: Boolean(publicEnv.liquidityLockerAddress),
      detail: publicEnv.liquidityLockerAddress || "VITE_LIQUIDITY_LOCKER_ADDRESS not set",
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

export const chainWritesReady = () => Boolean(publicEnv.assetRegistryAddress);
