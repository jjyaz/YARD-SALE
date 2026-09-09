import { expect } from "chai";
import hre from "hardhat";
import type { Contract } from "ethers";
import { runDeployment, validateDeployment, emptyRecord, type DeploymentRecord } from "../lib/deploy-core";

const { makeVoucher } = require("./helpers/voucher");

const EXPECTED_ROLE_STEPS = [
  "registry.grantRole(PAIRING_ROLE, factory)",
  "registry.grantRole(SIGNER_ROLE, platformSigner)",
  "registry.grantRole(DEFAULT_ADMIN_ROLE, admin)",
  "registry.grantRole(PAUSER_ROLE, admin)",
  "registry.grantRole(STATUS_ROLE, admin)",
  "factory.grantRole(DEFAULT_ADMIN_ROLE, admin)",
  "factory.grantRole(PAUSER_ROLE, admin)",
  "registry.renounceRole(SIGNER_ROLE, deployer)",
  "registry.renounceRole(PAUSER_ROLE, deployer)",
  "registry.renounceRole(STATUS_ROLE, deployer)",
  "factory.renounceRole(PAUSER_ROLE, deployer)",
  "factory.renounceRole(DEFAULT_ADMIN_ROLE, deployer)",
  "registry.renounceRole(DEFAULT_ADMIN_ROLE, deployer)",
];

async function deployPositionManager(): Promise<string> {
  const PM = await hre.ethers.getContractFactory("MockPositionManager");
  const pm = await PM.deploy();
  return pm.getAddress();
}

describe("Deployment core (local simulation)", () => {
  it("deploys in order, hands over roles, renounces deployer, and validates", async () => {
    const [deployer, admin, treasury, seller, platformSigner] = await hre.ethers.getSigners();
    const positionManager = await deployPositionManager();
    const lines: string[] = [];
    const record = await runDeployment(
      hre,
      deployer,
      {
        admin: admin.address,
        treasury: treasury.address,
        platformSigner: platformSigner.address,
        positionManager,
      },
      { simulation: true, log: (l) => lines.push(l) },
    );

    expect(record.status).to.equal("simulated");
    expect(record.deployerRolesRenounced).to.equal(true);
    expect(record.contracts.implementation?.address).to.match(/^0x[0-9a-fA-F]{40}$/);
    expect(record.contracts.locker?.address).to.match(/^0x[0-9a-fA-F]{40}$/);
    expect(record.contracts.registry?.blockNumber).to.be.lessThan(record.contracts.factory!.blockNumber);
    expect(record.contracts.implementation!.blockNumber).to.be.lessThan(record.contracts.registry!.blockNumber);
    expect(record.roleTransactions.map((r) => r.step)).to.deep.equal(EXPECTED_ROLE_STEPS);
    expect(JSON.stringify(record)).to.not.match(/privateKey|mnemonic/i);

    const checks = await validateDeployment(hre, record);
    const failed = checks.filter((c) => !c.ok);
    expect(failed, JSON.stringify(failed)).to.deep.equal([]);

    // The system works for a seller after handover, using a platform-signed voucher.
    const registry = await hre.ethers.getContractAt("YardSaleAssetRegistry", record.contracts.registry!.address);
    const factory = await hre.ethers.getContractAt("YardTokenFactory", record.contracts.factory!.address);
    const as = (c: unknown, signer: unknown) => (c as Contract).connect(signer as never) as unknown as Contract;
    const listing = hre.ethers.id("post-handover");
    const { voucher, signature, uri } = await makeVoucher({
      registry,
      signer: platformSigner,
      seller: seller.address,
      listingId: listing,
      uri: "ipfs://x",
      metadataHash: hre.ethers.id("m"),
      termsHash: hre.ethers.id("t"),
    });
    await as(registry, seller).mintPassport(voucher, uri, signature);
    const tokenId = await registry.tokenIdForListing(listing);
    await as(factory, seller).createCompanionToken(tokenId, "Post", "POST", 1000n, 1000n);
    expect(await registry.companionTokenOf(tokenId)).to.equal(await factory.tokenForPassport(tokenId));

    // Deployer can no longer administer anything, and can no longer authorize a mint.
    await expect(as(registry, deployer).pause()).to.be.revertedWithCustomError(
      registry,
      "AccessControlUnauthorizedAccount",
    );
    await expect(as(factory, deployer).pause()).to.be.revertedWithCustomError(
      factory,
      "AccessControlUnauthorizedAccount",
    );
    const rogue = await makeVoucher({
      registry,
      signer: deployer,
      seller: seller.address,
      listingId: hre.ethers.id("rogue"),
      uri: "ipfs://y",
      metadataHash: hre.ethers.id("m"),
      termsHash: hre.ethers.id("t"),
      nonce: 1n,
    });
    await expect(
      as(registry, seller).mintPassport(rogue.voucher, rogue.uri, rogue.signature),
    ).to.be.revertedWithCustomError(registry, "InvalidVoucherSignature");

    await as(registry, admin).pause();
    await as(registry, admin).unpause();
  });

  it("refuses to finish when the admin equals the deployer", async () => {
    const [deployer, , treasury, , platformSigner] = await hre.ethers.getSigners();
    await expect(
      runDeployment(
        hre,
        deployer,
        { admin: deployer.address, treasury: treasury.address, platformSigner: platformSigner.address },
        { simulation: true, log: () => {} },
      ),
    ).to.be.rejectedWith(/administrator address equals the deployer/);
  });

  it("ADVERSARIAL: resumes a partial deployment without creating untracked contracts", async () => {
    const [deployer, admin, treasury, , platformSigner] = await hre.ethers.getSigners();
    const saved: DeploymentRecord[] = [];
    let partial: DeploymentRecord | null = null;

    // Abort right after the factory is recorded, by throwing from persist().
    try {
      await runDeployment(
        hre,
        deployer,
        { admin: admin.address, treasury: treasury.address, platformSigner: platformSigner.address },
        {
          simulation: true,
          log: () => {},
          persist: (r) => {
            partial = JSON.parse(JSON.stringify(r)) as DeploymentRecord;
            saved.push(partial);
            if (r.contracts.factory) throw new Error("simulated crash after factory deploy");
          },
        },
      );
      expect.fail("expected the simulated crash");
    } catch (e) {
      expect((e as Error).message).to.contain("simulated crash");
    }

    expect(partial).to.not.equal(null);
    const before = partial as unknown as DeploymentRecord;
    expect(before.status).to.equal("in_progress");
    expect(before.contracts.factory?.address).to.match(/^0x[0-9a-fA-F]{40}$/);

    const resumed = await runDeployment(
      hre,
      deployer,
      { admin: admin.address, treasury: treasury.address, platformSigner: platformSigner.address },
      { simulation: true, log: () => {}, resumeFrom: before },
    );
    // Same addresses: nothing was redeployed.
    expect(resumed.contracts.implementation!.address).to.equal(before.contracts.implementation!.address);
    expect(resumed.contracts.registry!.address).to.equal(before.contracts.registry!.address);
    expect(resumed.contracts.factory!.address).to.equal(before.contracts.factory!.address);
    expect(resumed.deployerRolesRenounced).to.equal(true);
    const failed = (await validateDeployment(hre, resumed)).filter((c) => !c.ok);
    expect(failed, JSON.stringify(failed)).to.deep.equal([]);
  });

  it("flags a broken record", async () => {
    const net = await hre.ethers.provider.getNetwork();
    const record = emptyRecord(hre, Number(net.chainId), hre.network.name);
    const checks = await validateDeployment(hre, record);
    expect(checks.some((c) => c.check === "record complete" && !c.ok)).to.equal(true);
  });
});
