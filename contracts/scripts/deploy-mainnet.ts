/**
 * Robinhood Chain MAINNET deployment (chainId 4663).
 *
 *   Plan only (no broadcast):
 *     npx hardhat run scripts/deploy-mainnet.ts --network robinhoodMainnet
 *
 *   Broadcast:
 *     CONFIRM_MAINNET_DEPLOY=YES npx hardhat run scripts/deploy-mainnet.ts --network robinhoodMainnet
 *
 * Required env (contracts/.env, see .env.deploy.example):
 *   MAINNET_DEPLOYER_PRIVATE_KEY   read by hardhat.config.ts only; never printed
 *   RH_MAINNET_RPC_URL             mainnet RPC
 *   MAINNET_ADMIN_ADDRESS          permanent administrator (nonzero, ideally a multisig)
 * Optional:
 *   MAINNET_TREASURY_ADDRESS       receives the non-creator token share; defaults to the admin
 */
import hre from "hardhat";
import {
  DEPLOY_ORDER,
  MAINNET_CHAIN_ID,
  estimateDeploymentCost,
  printChecks,
  readRecord,
  requireAddressEnv,
  requireChain,
  runDeployment,
  validateDeployment,
  writeRecord,
} from "../lib/deploy-core";

const log = (line: string) => console.log(line);

async function main() {
  const { ethers } = hre;

  if (hre.network.name !== "robinhoodMainnet") {
    throw new Error(`Run with --network robinhoodMainnet (got ${hre.network.name}).`);
  }
  await requireChain(hre, MAINNET_CHAIN_ID);

  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No deployer signer. Set MAINNET_DEPLOYER_PRIVATE_KEY in contracts/.env.");

  const admin = requireAddressEnv("MAINNET_ADMIN_ADDRESS");
  const treasury = requireAddressEnv("MAINNET_TREASURY_ADDRESS", admin);

  const existing = readRecord(hre, MAINNET_CHAIN_ID);
  if (existing && existing.status === "deployed") {
    throw new Error(
      `deployments/${MAINNET_CHAIN_ID}.json already records a live deployment ` +
        `(registry ${existing.contracts.registry?.address}). Refusing to deploy twice. ` +
        `Move that file aside deliberately if you truly intend a second deployment.`,
    );
  }

  const deployerAddress = await deployer.getAddress();
  const balance = await ethers.provider.getBalance(deployerAddress);
  const estimate = await estimateDeploymentCost(hre, deployer, { admin, treasury });

  log("=== YARD SALE mainnet deployment plan ===");
  log(`Network            : Robinhood Chain (chainId ${MAINNET_CHAIN_ID})`);
  log(`RPC                : ${process.env.RH_MAINNET_RPC_URL ? "RH_MAINNET_RPC_URL (set)" : "default public RPC"}`);
  log(`Deployer           : ${deployerAddress}`);
  log(`Deployer balance   : ${ethers.formatEther(balance)} ETH`);
  log(`Admin (permanent)  : ${admin}`);
  log(`Treasury           : ${treasury}`);
  log(`Est. gas           : ${estimate.gas.toString()} @ ${ethers.formatUnits(estimate.gasPrice, "gwei")} gwei`);
  log(`Est. cost          : ~${ethers.formatEther(estimate.wei)} ETH`);
  log("Contract order     :");
  DEPLOY_ORDER.forEach((step, i) => log(`  ${i + 1}. ${step}`));
  log("Constructor args   :");
  log(`  YardCompanionToken()`);
  log(`  YardSaleAssetRegistry(admin=${deployerAddress})  -> roles handed to ${admin} afterwards`);
  log(`  YardTokenFactory(admin=${deployerAddress}, registry=<step 2>, treasury=${treasury}, implementation=<step 1>)`);
  log("Per-step gas       :");
  estimate.perStep.forEach((s) => log(`  ${s.gas.toString().padStart(9)}  ${s.step}`));

  if (balance < estimate.wei) {
    throw new Error(`Deployer balance is below the estimated cost. Fund ${deployerAddress} and retry.`);
  }

  if (process.env.CONFIRM_MAINNET_DEPLOY !== "YES") {
    log("");
    log("DRY RUN ONLY. Nothing was broadcast.");
    log("To deploy for real, re-run with CONFIRM_MAINNET_DEPLOY=YES");
    return;
  }

  log("");
  log("CONFIRM_MAINNET_DEPLOY=YES received. Broadcasting ...");
  const record = await runDeployment(hre, deployer, { admin, treasury }, { simulation: false, log });

  log("");
  log("Validating live state ...");
  const checks = await validateDeployment(hre, record);
  const ok = printChecks(checks, log);
  if (!ok) {
    record.notes.push("Post-deployment validation reported failures; investigate before activating the app.");
  }

  const file = writeRecord(hre, record);
  log("");
  log(`Deployment record written to ${file}`);
  log("");
  log("Next:");
  log(`  npx hardhat run scripts/verify-mainnet.ts --network robinhoodMainnet`);
  log(`  npx hardhat run scripts/check-mainnet-deployment.ts --network robinhoodMainnet`);
  log("");
  log("Frontend variables (public, safe to commit to the app environment):");
  log(`  VITE_DEFAULT_CHAIN_ID=4663`);
  log(`  VITE_ASSET_REGISTRY_ADDRESS=${record.contracts.registry?.address}`);
  log(`  VITE_TOKEN_FACTORY_ADDRESS=${record.contracts.factory?.address}`);
  log(`  VITE_ROBINHOOD_MAINNET_RPC_URL=<your mainnet RPC>`);
  log(`  VITE_ENABLE_MAINNET=false   # flip to true only after the app's Status page shows every check green`);
  if (!ok) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
