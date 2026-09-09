import "@nomicfoundation/hardhat-toolbox";
import type { HardhatUserConfig } from "hardhat/config";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Credentials are read ONLY from this package's environment.
 * The frontend never sees them, and nothing here prints them.
 *
 * Testnet deployer:  DEPLOYER_PRIVATE_KEY   (network robinhoodTestnet)
 * Mainnet deployer:  MAINNET_DEPLOYER_PRIVATE_KEY (network robinhoodMainnet)
 */
const testnetKey = process.env.DEPLOYER_PRIVATE_KEY || "";
const mainnetKey = process.env.MAINNET_DEPLOYER_PRIVATE_KEY || "";

export const ROBINHOOD_MAINNET = {
  name: "robinhoodMainnet",
  chainId: 4663,
  rpcEnv: "RH_MAINNET_RPC_URL",
  defaultRpc: "https://rpc.mainnet.chain.robinhood.com",
  explorer: "https://robinhoodchain.blockscout.com",
  explorerApi: "https://robinhoodchain.blockscout.com/api/",
} as const;

export const ROBINHOOD_TESTNET = {
  name: "robinhoodTestnet",
  chainId: 46630,
  rpcEnv: "ROBINHOOD_TESTNET_RPC_URL",
  defaultRpc: "https://rpc.testnet.chain.robinhood.com",
  explorer: "https://explorer.testnet.chain.robinhood.com",
  explorerApi: "https://explorer.testnet.chain.robinhood.com/api",
} as const;

const forkUrl =
  process.env.MAINNET_FORK === "true" ? process.env[ROBINHOOD_MAINNET.rpcEnv] : undefined;

/**
 * Local end-to-end rehearsals: `LOCAL_CHAIN_ID=46630 npx hardhat node` starts an in-memory chain
 * that reports the testnet chain id, so the app (pointed at http://127.0.0.1:8545) exercises the
 * exact same code path it uses against the real network. Never used for real deployments.
 */
const localChainId = process.env.LOCAL_CHAIN_ID ? Number(process.env.LOCAL_CHAIN_ID) : undefined;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: forkUrl
      ? {
          // Mainnet-fork simulation: same chain id, same state, no real broadcast.
          chainId: ROBINHOOD_MAINNET.chainId,
          forking: { url: forkUrl },
        }
      : localChainId
        ? { chainId: localChainId }
        : {},
    [ROBINHOOD_TESTNET.name]: {
      url: process.env[ROBINHOOD_TESTNET.rpcEnv] || ROBINHOOD_TESTNET.defaultRpc,
      chainId: ROBINHOOD_TESTNET.chainId,
      accounts: testnetKey ? [testnetKey] : [],
    },
    [ROBINHOOD_MAINNET.name]: {
      url: process.env[ROBINHOOD_MAINNET.rpcEnv] || ROBINHOOD_MAINNET.defaultRpc,
      chainId: ROBINHOOD_MAINNET.chainId,
      accounts: mainnetKey ? [mainnetKey] : [],
    },
  },
  etherscan: {
    apiKey: {
      [ROBINHOOD_TESTNET.name]: process.env.EXPLORER_API_KEY || "no-api-key-required",
      [ROBINHOOD_MAINNET.name]: process.env.BLOCKSCOUT_API_KEY || "no-api-key-required",
    },
    customChains: [
      {
        network: ROBINHOOD_TESTNET.name,
        chainId: ROBINHOOD_TESTNET.chainId,
        urls: { apiURL: ROBINHOOD_TESTNET.explorerApi, browserURL: ROBINHOOD_TESTNET.explorer },
      },
      {
        network: ROBINHOOD_MAINNET.name,
        chainId: ROBINHOOD_MAINNET.chainId,
        urls: { apiURL: ROBINHOOD_MAINNET.explorerApi, browserURL: ROBINHOOD_MAINNET.explorer },
      },
    ],
  },
  sourcify: { enabled: false },
  mocha: { timeout: 120_000 },
};

export default config;
