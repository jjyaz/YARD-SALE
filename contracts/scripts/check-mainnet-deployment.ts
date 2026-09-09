/**
 * Validates deployments/4663.json against live Robinhood Chain state. Read-only; needs no key.
 *
 *   npx hardhat run scripts/check-mainnet-deployment.ts --network robinhoodMainnet
 *
 * Exit code 0 when every check passes, 2 when any check fails, 1 on configuration errors.
 */
import hre from "hardhat";
import {
  MAINNET_CHAIN_ID,
  printChecks,
  readRecord,
  requireChain,
  validateDeployment,
} from "../lib/deploy-core";

async function main() {
  await requireChain(hre, MAINNET_CHAIN_ID);
  const record = readRecord(hre, MAINNET_CHAIN_ID);
  if (!record || record.status !== "deployed") {
    throw new Error(
      `deployments/${MAINNET_CHAIN_ID}.json has no live deployment (status: ${record?.status ?? "missing"}). ` +
        "Run scripts/deploy-mainnet.ts first.",
    );
  }
  console.log(`Checking deployment recorded at ${record.deployedAt}`);
  console.log(`  registry       : ${record.contracts.registry?.address}`);
  console.log(`  factory        : ${record.contracts.factory?.address}`);
  console.log(`  implementation : ${record.contracts.implementation?.address}`);
  console.log("");
  const results = await validateDeployment(hre, record);
  const ok = printChecks(results, (l) => console.log(l));
  console.log("");
  console.log(ok ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED — do not enable VITE_ENABLE_MAINNET");
  if (!ok) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
