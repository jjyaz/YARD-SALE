const { expect } = require("chai");
const { ethers } = require("hardhat");

const LISTING_A = ethers.id("listing-a");
const LISTING_B = ethers.id("listing-b");
const META_HASH = ethers.id("metadata");
const TERMS_HASH = ethers.id("terms");
const URI = "https://cdn.example/passports/listing-a.json";

async function deployFixture() {
  const [admin, seller, other, treasury] = await ethers.getSigners();
  const Registry = await ethers.getContractFactory("YardSaleAssetRegistry");
  const registry = await Registry.deploy(admin.address);
  const Factory = await ethers.getContractFactory("YardTokenFactory");
  const factory = await Factory.deploy(admin.address, await registry.getAddress(), treasury.address);
  await registry.grantRole(await registry.PAIRING_ROLE(), await factory.getAddress());
  return { admin, seller, other, treasury, registry, factory };
}

describe("YardSaleAssetRegistry", () => {
  it("mints a passport and stores immutable metadata", async () => {
    const { registry, seller } = await deployFixture();
    await expect(registry.connect(seller).mintPassport(seller.address, LISTING_A, URI, META_HASH, TERMS_HASH))
      .to.emit(registry, "PassportMinted")
      .withArgs(1n, seller.address, LISTING_A, URI, META_HASH, TERMS_HASH);

    const p = await registry.passport(1n);
    expect(p.listingId).to.equal(LISTING_A);
    expect(p.metadataHash).to.equal(META_HASH);
    expect(p.termsHash).to.equal(TERMS_HASH);
    expect(p.companionToken).to.equal(ethers.ZeroAddress);
    expect(p.status).to.equal(0n);
    expect(await registry.tokenURI(1n)).to.equal(URI);
    expect(await registry.ownerOf(1n)).to.equal(seller.address);
    expect(await registry.tokenIdForListing(LISTING_A)).to.equal(1n);
    expect(await registry.totalMinted()).to.equal(1n);
  });

  it("allows only one mint per listing", async () => {
    const { registry, seller, other } = await deployFixture();
    await registry.connect(seller).mintPassport(seller.address, LISTING_A, URI, META_HASH, TERMS_HASH);
    await expect(registry.connect(other).mintPassport(other.address, LISTING_A, URI, META_HASH, TERMS_HASH))
      .to.be.revertedWithCustomError(registry, "ListingAlreadyMinted")
      .withArgs(LISTING_A);
  });

  it("rejects empty inputs", async () => {
    const { registry, seller } = await deployFixture();
    await expect(
      registry.connect(seller).mintPassport(seller.address, ethers.ZeroHash, URI, META_HASH, TERMS_HASH),
    ).to.be.revertedWithCustomError(registry, "EmptyListingId");
    await expect(
      registry.connect(seller).mintPassport(seller.address, LISTING_A, "", META_HASH, TERMS_HASH),
    ).to.be.revertedWithCustomError(registry, "EmptyMetadataURI");
    await expect(
      registry.connect(seller).mintPassport(seller.address, LISTING_A, URI, ethers.ZeroHash, TERMS_HASH),
    ).to.be.revertedWithCustomError(registry, "EmptyHash");
    await expect(
      registry.connect(seller).mintPassport(ethers.ZeroAddress, LISTING_A, URI, META_HASH, TERMS_HASH),
    ).to.be.revertedWithCustomError(registry, "ZeroAddress");
  });

  it("only lets a minter mint on behalf of someone else", async () => {
    const { registry, seller, other, admin } = await deployFixture();
    await expect(
      registry.connect(other).mintPassport(seller.address, LISTING_A, URI, META_HASH, TERMS_HASH),
    ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    await expect(registry.connect(admin).mintPassport(seller.address, LISTING_A, URI, META_HASH, TERMS_HASH)).to.emit(
      registry,
      "PassportMinted",
    );
  });

  it("changes lifecycle status only with the status role", async () => {
    const { registry, seller, admin } = await deployFixture();
    await registry.connect(seller).mintPassport(seller.address, LISTING_A, URI, META_HASH, TERMS_HASH);
    await expect(registry.connect(seller).setStatus(1n, 2)).to.be.revertedWithCustomError(
      registry,
      "AccessControlUnauthorizedAccount",
    );
    await expect(registry.connect(admin).setStatus(1n, 2)).to.emit(registry, "PassportStatusChanged").withArgs(1n, 0, 2);
    await expect(registry.connect(admin).setStatus(1n, 2)).to.be.revertedWithCustomError(registry, "StatusUnchanged");
  });

  it("pauses mints and transfers", async () => {
    const { registry, seller, admin, other } = await deployFixture();
    await registry.connect(seller).mintPassport(seller.address, LISTING_A, URI, META_HASH, TERMS_HASH);
    await registry.connect(admin).pause();
    await expect(
      registry.connect(seller).mintPassport(seller.address, LISTING_B, URI, META_HASH, TERMS_HASH),
    ).to.be.revertedWithCustomError(registry, "EnforcedPause");
    await expect(
      registry.connect(seller).transferFrom(seller.address, other.address, 1n),
    ).to.be.revertedWithCustomError(registry, "EnforcedPause");
    await registry.connect(admin).unpause();
    await registry.connect(seller).transferFrom(seller.address, other.address, 1n);
    expect(await registry.ownerOf(1n)).to.equal(other.address);
  });

  it("reverts reads for unknown passports", async () => {
    const { registry } = await deployFixture();
    await expect(registry.passport(99n)).to.be.revertedWithCustomError(registry, "UnknownPassport");
    expect(await registry.exists(99n)).to.equal(false);
  });

  it("pairs a companion token only once and only from the pairing role", async () => {
    const { registry, seller, other } = await deployFixture();
    await registry.connect(seller).mintPassport(seller.address, LISTING_A, URI, META_HASH, TERMS_HASH);
    await expect(registry.connect(other).setCompanionToken(1n, other.address)).to.be.revertedWithCustomError(
      registry,
      "AccessControlUnauthorizedAccount",
    );
  });
});

describe("YardTokenFactory + YardCompanionToken", () => {
  async function mintedFixture() {
    const base = await deployFixture();
    await base.registry
      .connect(base.seller)
      .mintPassport(base.seller.address, LISTING_A, URI, META_HASH, TERMS_HASH);
    return base;
  }

  it("creates a fixed-supply clone paired to the passport", async () => {
    const { factory, registry, seller, treasury } = await mintedFixture();
    const supply = ethers.parseUnits("1000000", 18);
    const allocation = ethers.parseUnits("700000", 18);
    const predicted = await factory.predictTokenAddress(1n);

    await expect(factory.connect(seller).createCompanionToken(1n, "Teak Desk", "TEAK", supply, allocation))
      .to.emit(factory, "CompanionTokenCreated")
      .withArgs(1n, predicted, seller.address, "Teak Desk", "TEAK", supply, allocation);

    const token = await ethers.getContractAt("YardCompanionToken", predicted);
    expect(await token.name()).to.equal("Teak Desk");
    expect(await token.symbol()).to.equal("TEAK");
    expect(await token.totalSupply()).to.equal(supply);
    expect(await token.balanceOf(seller.address)).to.equal(allocation);
    expect(await token.balanceOf(treasury.address)).to.equal(supply - allocation);
    expect(await token.passportTokenId()).to.equal(1n);
    expect(await token.registry()).to.equal(await registry.getAddress());
    expect(await registry.companionTokenOf(1n)).to.equal(predicted);
    expect(await factory.tokenForPassport(1n)).to.equal(predicted);
    expect(await ethers.provider.getCode(predicted)).to.not.equal("0x");
  });

  it("never allows a second token for the same passport", async () => {
    const { factory, seller } = await mintedFixture();
    const supply = ethers.parseUnits("1000", 18);
    await factory.connect(seller).createCompanionToken(1n, "A", "A", supply, supply);
    await expect(
      factory.connect(seller).createCompanionToken(1n, "B", "B", supply, supply),
    ).to.be.revertedWithCustomError(factory, "PassportAlreadyTokenized");
  });

  it("only the passport owner can tokenize", async () => {
    const { factory, other } = await mintedFixture();
    const supply = ethers.parseUnits("1000", 18);
    await expect(
      factory.connect(other).createCompanionToken(1n, "A", "A", supply, supply),
    ).to.be.revertedWithCustomError(factory, "NotPassportOwner");
  });

  it("validates token inputs", async () => {
    const { factory, seller } = await mintedFixture();
    const supply = ethers.parseUnits("1000", 18);
    await expect(factory.connect(seller).createCompanionToken(1n, "", "A", supply, supply)).to.be.revertedWithCustomError(
      factory,
      "EmptyName",
    );
    await expect(factory.connect(seller).createCompanionToken(1n, "A", "", supply, supply)).to.be.revertedWithCustomError(
      factory,
      "EmptySymbol",
    );
    const impl = await ethers.getContractAt("YardCompanionToken", await factory.implementation());
    await expect(factory.connect(seller).createCompanionToken(1n, "A", "A", 0, 0)).to.be.revertedWithCustomError(
      impl,
      "ZeroSupply",
    );
    await expect(
      factory.connect(seller).createCompanionToken(1n, "A", "A", supply, supply + 1n),
    ).to.be.revertedWithCustomError(impl, "InvalidAllocation");
  });

  it("exposes no minting, tax, blacklist, or owner surface", async () => {
    const { factory, seller } = await mintedFixture();
    const supply = ethers.parseUnits("1000", 18);
    await factory.connect(seller).createCompanionToken(1n, "A", "A", supply, supply);
    const token = await ethers.getContractAt("YardCompanionToken", await factory.tokenForPassport(1n));
    const fns = token.interface.fragments.filter((f) => f.type === "function").map((f) => f.name);
    for (const banned of ["mint", "burn", "setTax", "setFee", "blacklist", "owner", "rebase", "upgradeTo", "pause"]) {
      expect(fns).to.not.include(banned);
    }
    expect(await token.RIGHTS_DISCLAIMER()).to.contain("no ownership");
  });

  it("cannot be re-initialized", async () => {
    const { factory, seller, treasury, registry } = await mintedFixture();
    const supply = ethers.parseUnits("1000", 18);
    await factory.connect(seller).createCompanionToken(1n, "A", "A", supply, supply);
    const token = await ethers.getContractAt("YardCompanionToken", await factory.tokenForPassport(1n));
    await expect(
      token
        .connect(seller)
        .initialize("X", "X", supply, supply, seller.address, treasury.address, await registry.getAddress(), 1n),
    ).to.be.revertedWithCustomError(token, "InvalidInitialization");
  });

  it("transfers full supply without loss", async () => {
    const { factory, seller, other } = await mintedFixture();
    const supply = ethers.parseUnits("1000", 18);
    await factory.connect(seller).createCompanionToken(1n, "A", "A", supply, supply);
    const token = await ethers.getContractAt("YardCompanionToken", await factory.tokenForPassport(1n));
    await token.connect(seller).transfer(other.address, supply);
    expect(await token.balanceOf(other.address)).to.equal(supply);
    expect(await token.totalSupply()).to.equal(supply);
  });

  it("pauses token creation", async () => {
    const { factory, admin, seller } = await mintedFixture();
    await factory.connect(admin).pause();
    const supply = ethers.parseUnits("1000", 18);
    await expect(
      factory.connect(seller).createCompanionToken(1n, "A", "A", supply, supply),
    ).to.be.revertedWithCustomError(factory, "EnforcedPause");
  });
});
