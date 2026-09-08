/* Robinhood Chain TESTNET (46630) deployment. Never runs automatically. */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) throw new Error("No signer. Set DEPLOYER_PRIVATE_KEY in contracts/.env");

  const admin = process.env.ADMIN_ADDRESS || deployer.address;
  const treasury = process.env.TREASURY_ADDRESS || deployer.address;
  const net = await hre.ethers.provider.getNetwork();

  console.log(`Network   : ${hre.network.name} (chainId ${net.chainId})`);
  console.log(`Deployer  : ${deployer.address}`);
  console.log(`Admin     : ${admin}`);
  console.log(`Treasury  : ${treasury}`);

  if (net.chainId !== 46630n && hre.network.name !== "hardhat" && hre.network.name !== "localhost") {
    throw new Error(
      `Refusing to deploy to chainId ${net.chainId}. This script is testnet-only; use scripts/deploy-mainnet.ts for 4663.`,
    );
  }

  const Impl = await hre.ethers.getContractFactory("YardCompanionToken");
  const impl = await Impl.deploy();
  await impl.waitForDeployment();
  const implAddress = await impl.getAddress();
  console.log(`YardCompanionToken (impl): ${implAddress}`);

  const Registry = await hre.ethers.getContractFactory("YardSaleAssetRegistry");
  const registry = await Registry.deploy(deployer.address);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log(`YardSaleAssetRegistry    : ${registryAddress}`);

  const Factory = await hre.ethers.getContractFactory("YardTokenFactory");
  const factory = await Factory.deploy(deployer.address, registryAddress, treasury, implAddress);
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log(`YardTokenFactory         : ${factoryAddress}`);

  const PAIRING_ROLE = await registry.PAIRING_ROLE();
  await (await registry.grantRole(PAIRING_ROLE, factoryAddress)).wait();
  console.log("Granted PAIRING_ROLE to the factory.");

  if (admin.toLowerCase() !== deployer.address.toLowerCase()) {
    const DEFAULT_ADMIN_ROLE = await registry.DEFAULT_ADMIN_ROLE();
    await (await registry.grantRole(DEFAULT_ADMIN_ROLE, admin)).wait();
    await (await factory.grantRole(DEFAULT_ADMIN_ROLE, admin)).wait();
    console.log(`Granted DEFAULT_ADMIN_ROLE on both contracts to ${admin}. Deployer roles kept for testnet convenience.`);
  }

  const out = {
    network: hre.network.name,
    chainId: Number(net.chainId),
    deployer: deployer.address,
    admin,
    treasury,
    implementation: implAddress,
    registry: registryAddress,
    factory: factoryAddress,
    deployedAt: new Date().toISOString(),
  };
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${hre.network.name}.json`), JSON.stringify(out, null, 2));

  console.log("\nAdd these to the app configuration:");
  console.log(`VITE_DEFAULT_CHAIN_ID=46630`);
  console.log(`VITE_ASSET_REGISTRY_ADDRESS=${registryAddress}`);
  console.log(`VITE_TOKEN_FACTORY_ADDRESS=${factoryAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
