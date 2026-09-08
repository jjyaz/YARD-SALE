import { expect } from "chai";
import hre from "hardhat";
import type { Contract } from "ethers";
import { runDeployment, validateDeployment, emptyRecord } from "../lib/deploy-core";

describe("Deployment core (local simulation)", () => {
  it("deploys in order, hands over roles, renounces deployer, and validates", async () => {
    const [deployer, admin, treasury, seller] = await hre.ethers.getSigners();
    const lines: string[] = [];
    const record = await runDeployment(
      hre,
      deployer,
      { admin: admin.address, treasury: treasury.address },
      { simulation: true, log: (l) => lines.push(l) },
    );

    expect(record.status).to.equal("simulated");
    expect(record.deployerRolesRenounced).to.equal(true);
    expect(record.contracts.implementation?.address).to.match(/^0x[0-9a-fA-F]{40}$/);
    expect(record.contracts.registry?.blockNumber).to.be.lessThan(record.contracts.factory!.blockNumber);
    expect(record.contracts.implementation!.blockNumber).to.be.lessThan(record.contracts.registry!.blockNumber);
    expect(record.roleTransactions.map((r) => r.step)).to.deep.equal([
      "registry.grantRole(PAIRING_ROLE, factory)",
      "registry.grantRole(DEFAULT_ADMIN_ROLE, admin)",
      "registry.grantRole(PAUSER_ROLE, admin)",
      "registry.grantRole(STATUS_ROLE, admin)",
      "factory.grantRole(DEFAULT_ADMIN_ROLE, admin)",
      "factory.grantRole(PAUSER_ROLE, admin)",
      "registry.renounceRole(MINTER_ROLE, deployer)",
      "registry.renounceRole(PAUSER_ROLE, deployer)",
      "registry.renounceRole(STATUS_ROLE, deployer)",
      "factory.renounceRole(PAUSER_ROLE, deployer)",
      "factory.renounceRole(DEFAULT_ADMIN_ROLE, deployer)",
      "registry.renounceRole(DEFAULT_ADMIN_ROLE, deployer)",
    ]);
    expect(JSON.stringify(record)).to.not.match(/privateKey|mnemonic/i);

    const checks = await validateDeployment(hre, record);
    const failed = checks.filter((c) => !c.ok);
    expect(failed, JSON.stringify(failed)).to.deep.equal([]);

    // The system works for a seller after handover.
    const registry = await hre.ethers.getContractAt("YardSaleAssetRegistry", record.contracts.registry!.address);
    const factory = await hre.ethers.getContractAt("YardTokenFactory", record.contracts.factory!.address);
    const as = (c: unknown, signer: unknown) => (c as Contract).connect(signer as never) as unknown as Contract;
    const listing = hre.ethers.id("post-handover");
    await as(registry, seller).mintPassport(seller.address, listing, "ipfs://x", hre.ethers.id("m"), hre.ethers.id("t"));
    const tokenId = await registry.tokenIdForListing(listing);
    await as(factory, seller).createCompanionToken(tokenId, "Post", "POST", 1000n, 1000n);
    expect(await registry.companionTokenOf(tokenId)).to.equal(await factory.tokenForPassport(tokenId));

    // Deployer can no longer administer anything.
    await expect(as(registry, deployer).pause()).to.be.revertedWithCustomError(
      registry,
      "AccessControlUnauthorizedAccount",
    );
    await expect(as(factory, deployer).pause()).to.be.revertedWithCustomError(
      factory,
      "AccessControlUnauthorizedAccount",
    );
    // Admin can.
    await as(registry, admin).pause();
    await as(registry, admin).unpause();
  });

  it("flags a broken record", async () => {
    const net = await hre.ethers.provider.getNetwork();
    const record = emptyRecord(hre, Number(net.chainId), hre.network.name);
    const checks = await validateDeployment(hre, record);
    expect(checks.some((c) => c.check === "record complete" && !c.ok)).to.equal(true);
  });
});
