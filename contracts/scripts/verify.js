/* Verifies the TESTNET deployment on the Robinhood testnet explorer. */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const file = path.join(__dirname, "..", "deployments", `${hre.network.name}.json`);
  if (!fs.existsSync(file))
    throw new Error(`No deployment record at ${file}. Run the deploy script first.`);
  const d = JSON.parse(fs.readFileSync(file, "utf8"));

  await hre.run("verify:verify", { address: d.implementation, constructorArguments: [] });
  await hre.run("verify:verify", { address: d.registry, constructorArguments: [d.deployer] });
  await hre.run("verify:verify", {
    address: d.factory,
    constructorArguments: [d.deployer, d.registry, d.treasury, d.implementation],
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
