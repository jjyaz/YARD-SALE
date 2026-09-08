/**
 * Mainnet-fork deployment simulation. Runs the exact production steps against a local fork of
 * Robinhood Chain (chainId 4663) using a funded Hardhat test account. Nothing is broadcast and
 * deployments/4663.json is never touched.
 *
 *   MAINNET_FORK=true RH_MAINNET_RPC_URL=https://... npx hardhat run scripts/simulate-mainnet-deploy.ts
 *
 * MAINNET_ADMIN_ADDRESS is optional here; a second Hardhat account is used when it is absent.
 */
import hre from "hardhat";
import type { Contract } from "ethers";
import { MAINNET_CHAIN_ID, printChecks, requireChain, runDeployment, validateDeployment } from "../lib/deploy-core";

const log = (line: string) => console.log(line);

async function main() {
  if (process.env.MAINNET_FORK !== "true") {
    throw new Error("Set MAINNET_FORK=true (and RH_MAINNET_RPC_URL) so hardhat.config.ts forks mainnet.");
  }
  if (hre.network.name !== "hardhat") {
    throw new Error("The simulation must run on the in-process hardhat network, not a live one.");
  }
  await requireChain(hre, MAINNET_CHAIN_ID);

  const [deployer, fallbackAdmin] = await hre.ethers.getSigners();
  const admin = process.env.MAINNET_ADMIN_ADDRESS
    ? hre.ethers.getAddress(process.env.MAINNET_ADMIN_ADDRESS)
    : await fallbackAdmin.getAddress();
  const treasury = process.env.MAINNET_TREASURY_ADDRESS
    ? hre.ethers.getAddress(process.env.MAINNET_TREASURY_ADDRESS)
    : admin;

  const block = await hre.ethers.provider.getBlockNumber();
  log(`=== Mainnet-fork simulation (chainId ${MAINNET_CHAIN_ID}, forked at block ${block}) ===`);
  log(`Deployer (fork account): ${await deployer.getAddress()}`);
  log(`Admin                  : ${admin}`);
  log(`Treasury               : ${treasury}`);

  // Sanity: the official Uniswap v3 factory must exist on the fork, proving we forked the right chain.
  const uniFactory = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa";
  const uniCode = await hre.ethers.provider.getCode(uniFactory);
  log(`Uniswap v3 factory bytecode present on fork: ${uniCode !== "0x"}`);
  if (uniCode === "0x") throw new Error("Fork does not look like Robinhood Chain mainnet.");

  const record = await runDeployment(hre, deployer, { admin, treasury }, { simulation: true, log });

  log("");
  log("Validating simulated state ...");
  const checks = await validateDeployment(hre, record);
  const ok = printChecks(checks, log);

  // Exercise the user flow once on the fork: mint a passport and pair a token.
  const registry = await hre.ethers.getContractAt("YardSaleAssetRegistry", record.contracts.registry!.address);
  const factory = await hre.ethers.getContractAt("YardTokenFactory", record.contracts.factory!.address);
  const seller = (await hre.ethers.getSigners())[3];
  const listingId = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("simulation-listing"));
  const sellerRegistry = registry.connect(seller) as unknown as Contract;
  const sellerFactory = factory.connect(seller) as unknown as Contract;
  const mintTx = await sellerRegistry.mintPassport(await seller.getAddress(), listingId, "ipfs://simulation", hre.ethers.id("m"), hre.ethers.id("t"));
  await mintTx.wait();
  const tokenId = await registry.tokenIdForListing(listingId);
  const createTx = await sellerFactory.createCompanionToken(tokenId, "Sim Token", "SIM", hre.ethers.parseEther("1000"), hre.ethers.parseEther("400"));
  await createTx.wait();
  const token = await registry.companionTokenOf(tokenId);
  log(`Simulated passport #${tokenId} paired with ${token}`);

  log("");
  log(ok ? "SIMULATION PASSED. No transactions were broadcast." : "SIMULATION REPORTED FAILURES.");
  if (!ok) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
