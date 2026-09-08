import { defineChain } from "viem";

import { publicEnv, ROBINHOOD_MAINNET_ID, ROBINHOOD_TESTNET_ID } from "@/config/env";

export const robinhoodMainnet = defineChain({
  id: ROBINHOOD_MAINNET_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [publicEnv.mainnetRpcUrl] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

export const robinhoodTestnet = defineChain({
  id: ROBINHOOD_TESTNET_ID,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [publicEnv.testnetRpcUrl] } },
  blockExplorers: {
    default: { name: "Explorer", url: "https://explorer.testnet.chain.robinhood.com" },
  },
  testnet: true,
});

export const supportedChains = publicEnv.enableMainnet
  ? ([robinhoodTestnet, robinhoodMainnet] as const)
  : ([robinhoodTestnet] as const);

export function chainById(chainId: number) {
  return chainId === ROBINHOOD_MAINNET_ID ? robinhoodMainnet : robinhoodTestnet;
}

/** The chain every read and write in the app targets. Mainnet only when explicitly enabled. */
export const activeChain = chainById(publicEnv.activeChainId);

/** @deprecated Prefer `activeChain`; kept for existing imports. */
export const defaultChain = activeChain;

export const isMainnet = (chainId: number) => chainId === ROBINHOOD_MAINNET_ID;

export function explorerTxUrl(chainId: number, hash: string): string {
  return `${chainById(chainId).blockExplorers.default.url}/tx/${hash}`;
}

export function explorerAddressUrl(chainId: number, address: string): string {
  return `${chainById(chainId).blockExplorers.default.url}/address/${address}`;
}

export function explorerTokenUrl(chainId: number, address: string): string {
  return `${chainById(chainId).blockExplorers.default.url}/token/${address}`;
}

export function chainName(chainId: number): string {
  return chainById(chainId).name;
}

/**
 * Official Uniswap v3 deployment on Robinhood Chain mainnet (4663).
 * Source: Uniswap's official deployment page, cross-checked live via
 * `NonfungiblePositionManager.factory()` and `.WETH9()`.
 * There is no official Uniswap deployment on the testnet.
 */
export const uniswapMainnet = {
  chainId: ROBINHOOD_MAINNET_ID,
  factory: "0x1f7d7550b1b028f7571e69a784071f0205fd2efa",
  positionManager: "0x73991a25c818bf1f1128deaab1492d45638de0d3",
  quoterV2: "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7",
  universalRouter: "0x8876789976decbfcbbbe364623c63652db8c0904",
  permit2: "0x000000000022d473030f116ddee9f6b43ac78ba3",
  weth: "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
  usdg: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
} as const;

export const UNISWAP_FEE_TIER = 3000;
export const UNISWAP_TICK_SPACING = 60;
