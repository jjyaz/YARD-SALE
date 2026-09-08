/* Deploys the registry + factory and wires the pairing role. Never runs automatically. */
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
    throw new Error(`Refusing to deploy to chainId ${net.chainId}. Testnet 46630 only in this phase.`);
  }

  const Registry = await hre.ethers.getContractFactory("YardSaleAssetRegistry");
  const registry = await Registry.deploy(admin);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log(`YardSaleAssetRegistry: ${registryAddress}`);

  const Factory = await hre.ethers.getContractFactory("YardTokenFactory");
  const factory = await Factory.deploy(admin, registryAddress, treasury);
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log(`YardTokenFactory     : ${factoryAddress}`);
  console.log(`Clone implementation : ${await factory.implementation()}`);

  const PAIRING_ROLE = await registry.PAIRING_ROLE();
  if (admin.toLowerCase() === deployer.address.toLowerCase()) {
    const tx = await registry.grantRole(PAIRING_ROLE, factoryAddress);
    await tx.wait();
    console.log("Granted PAIRING_ROLE to the factory.");
  } else {
    console.log(`MANUAL STEP: admin ${admin} must call registry.grantRole(${PAIRING_ROLE}, ${factoryAddress})`);
  }

  const out = {
    network: hre.network.name,
    chainId: Number(net.chainId),
    deployer: deployer.address,
    admin,
    treasury,
    registry: registryAddress,
    factory: factoryAddress,
    implementation: await factory.implementation(),
    deployedAt: new Date().toISOString(),
  };
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${hre.network.name}.json`), JSON.stringify(out, null, 2));

  console.log("\nAdd these to the app configuration:");
  console.log(`VITE_ASSET_REGISTRY_ADDRESS=${registryAddress}`);
  console.log(`VITE_TOKEN_FACTORY_ADDRESS=${factoryAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
