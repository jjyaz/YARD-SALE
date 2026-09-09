/**
 * Verifies the three mainnet contracts on Blockscout using deployments/4663.json.
 *
 *   npx hardhat run scripts/verify-mainnet.ts --network robinhoodMainnet
 *
 * Blockscout normally needs no API key. BLOCKSCOUT_API_KEY is optional.
 */
import hre from "hardhat";
import { MAINNET_CHAIN_ID, readRecord, requireChain } from "../lib/deploy-core";

async function verify(
  name: string,
  address: string,
  constructorArguments: unknown[],
  contract: string,
) {
  console.log(`Verifying ${name} at ${address} ...`);
  try {
    await hre.run("verify:verify", { address, constructorArguments, contract });
    console.log(`  verified: https://robinhoodchain.blockscout.com/address/${address}#code`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already verified/i.test(message)) {
      console.log("  already verified");
    } else {
      throw error;
    }
  }
}

async function main() {
  await requireChain(hre, MAINNET_CHAIN_ID);
  const record = readRecord(hre, MAINNET_CHAIN_ID);
  if (!record || record.status !== "deployed") {
    throw new Error(`deployments/${MAINNET_CHAIN_ID}.json has no live deployment to verify.`);
  }
  const { implementation, registry, factory, locker } = record.contracts;
  if (!implementation || !registry || !factory) throw new Error("Deployment record is incomplete.");

  await verify(
    "YardCompanionToken",
    implementation.address,
    implementation.constructorArgs,
    "contracts/YardCompanionToken.sol:YardCompanionToken",
  );
  await verify(
    "YardSaleAssetRegistry",
    registry.address,
    registry.constructorArgs,
    "contracts/YardSaleAssetRegistry.sol:YardSaleAssetRegistry",
  );
  await verify(
    "YardTokenFactory",
    factory.address,
    factory.constructorArgs,
    "contracts/YardTokenFactory.sol:YardTokenFactory",
  );
  if (locker) {
    await verify(
      "YardLiquidityLocker",
      locker.address,
      locker.constructorArgs,
      "contracts/YardLiquidityLocker.sol:YardLiquidityLocker",
    );
  }
  console.log("Done.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
