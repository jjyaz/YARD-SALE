const { expect } = require("chai");
const { ethers } = require("hardhat");
const { makeVoucher } = require("./helpers/voucher");

const LISTING_A = ethers.id("listing-a");
const LISTING_B = ethers.id("listing-b");
const META_HASH = ethers.id("metadata");
const TERMS_HASH = ethers.id("terms");
const URI = "ipfs://bafy-example/listing-a.json";
const URI_B = "ipfs://bafy-example/listing-b.json";

async function deployFixture() {
  const [admin, seller, other, treasury, newAdmin, platformSigner] = await ethers.getSigners();
  const Impl = await ethers.getContractFactory("YardCompanionToken");
  const impl = await Impl.deploy();
  const Registry = await ethers.getContractFactory("YardSaleAssetRegistry");
  const registry = await Registry.deploy(admin.address);
  const Factory = await ethers.getContractFactory("YardTokenFactory");
  const factory = await Factory.deploy(
    admin.address,
    await registry.getAddress(),
    treasury.address,
    await impl.getAddress(),
  );
  await registry.grantRole(await registry.PAIRING_ROLE(), await factory.getAddress());
  await registry.grantRole(await registry.SIGNER_ROLE(), platformSigner.address);
  return { admin, seller, other, treasury, newAdmin, platformSigner, registry, factory, impl };
}

/** Signs a voucher with the platform signer and mints it from `as`. */
async function mintFor(base, as, overrides = {}) {
  const { voucher, signature, uri } = await makeVoucher({
    registry: base.registry,
    signer: overrides.signer ?? base.platformSigner,
    seller: overrides.seller ?? as.address,
    listingId: overrides.listingId ?? LISTING_A,
    uri: overrides.uri ?? URI,
    metadataHash: overrides.metadataHash ?? META_HASH,
    termsHash: overrides.termsHash ?? TERMS_HASH,
    nonce: overrides.nonce ?? 0n,
    expiry: overrides.expiry,
    chainId: overrides.chainId,
    verifyingContract: overrides.verifyingContract,
  });
  return base.registry.connect(as).mintPassport(voucher, overrides.sentURI ?? uri, signature);
}

async function mintedFixture() {
  const base = await deployFixture();
  await mintFor(base, base.seller);
  return base;
}

describe("YardSaleAssetRegistry — voucher-authorized minting", () => {
  it("mints a passport and stores immutable metadata", async () => {
    const base = await deployFixture();
    const { registry, seller } = base;
    await expect(mintFor(base, seller))
      .to.emit(registry, "PassportMinted")
      .withArgs(1n, seller.address, LISTING_A, URI, META_HASH, TERMS_HASH)
      .and.to.emit(registry, "MintVoucherRedeemed")
      .withArgs(seller.address, 0n, 1n, base.platformSigner.address);

    const p = await registry.passport(1n);
    expect(p.listingId).to.equal(LISTING_A);
    expect(p.metadataHash).to.equal(META_HASH);
    expect(p.termsHash).to.equal(TERMS_HASH);
    expect(p.companionToken).to.equal(ethers.ZeroAddress);
    expect(p.status).to.equal(0n);
    expect(await registry.tokenURI(1n)).to.equal(URI);
    expect(await registry.ownerOf(1n)).to.equal(seller.address);
    expect(await registry.passportOfListing(LISTING_A)).to.equal(1n);
    expect(await registry.passportOfListing(LISTING_B)).to.equal(0n);
    expect(await registry.totalMinted()).to.equal(1n);
    expect(await registry.voucherUsed(seller.address, 0n)).to.equal(true);
  });

  it("has no unauthorized self-mint path", async () => {
    const { registry } = await deployFixture();
    const mints = registry.interface.fragments.filter(
      (f) => f.type === "function" && f.name === "mintPassport",
    );
    expect(mints).to.have.length(1);
    expect(mints[0].inputs).to.have.length(3);
  });

  it("ADVERSARIAL: listing-id front-running fails without a voucher for that attacker", async () => {
    const base = await deployFixture();
    // Attacker knows the public listing UUID but has no platform signature for their own wallet.
    await expect(
      mintFor(base, base.other, { seller: base.other.address, signer: base.other }),
    ).to.be.revertedWithCustomError(base.registry, "InvalidVoucherSignature");
    // The legitimate seller can still mint.
    await expect(mintFor(base, base.seller)).to.emit(base.registry, "PassportMinted");
  });

  it("ADVERSARIAL: an attacker cannot redeem a voucher issued to another seller", async () => {
    const base = await deployFixture();
    const { voucher, signature } = await makeVoucher({
      registry: base.registry,
      signer: base.platformSigner,
      seller: base.seller.address,
      listingId: LISTING_A,
      uri: URI,
      metadataHash: META_HASH,
      termsHash: TERMS_HASH,
    });
    await expect(
      base.registry.connect(base.other).mintPassport(voucher, URI, signature),
    ).to.be.revertedWithCustomError(base.registry, "VoucherSellerMismatch");
  });

  it("ADVERSARIAL: voucher replay fails", async () => {
    const base = await deployFixture();
    const { voucher, signature } = await makeVoucher({
      registry: base.registry,
      signer: base.platformSigner,
      seller: base.seller.address,
      listingId: LISTING_A,
      uri: URI,
      metadataHash: META_HASH,
      termsHash: TERMS_HASH,
      nonce: 7n,
    });
    await base.registry.connect(base.seller).mintPassport(voucher, URI, signature);
    await expect(base.registry.connect(base.seller).mintPassport(voucher, URI, signature))
      .to.be.revertedWithCustomError(base.registry, "VoucherAlreadyUsed")
      .withArgs(base.seller.address, 7n);

    // Same nonce, different listing => nonce replay guard fires.
    const replay = await makeVoucher({
      registry: base.registry,
      signer: base.platformSigner,
      seller: base.seller.address,
      listingId: LISTING_B,
      uri: URI_B,
      metadataHash: META_HASH,
      termsHash: TERMS_HASH,
      nonce: 7n,
    });
    await expect(
      base.registry.connect(base.seller).mintPassport(replay.voucher, URI_B, replay.signature),
    )
      .to.be.revertedWithCustomError(base.registry, "VoucherAlreadyUsed")
      .withArgs(base.seller.address, 7n);
  });

  it("ADVERSARIAL: a superseded voucher cannot mint after the listing is re-frozen and minted", async () => {
    const base = await deployFixture();
    const METADATA_A = ethers.id("metadata-A");
    const METADATA_B = ethers.id("metadata-B");
    const URI_A = "ipfs://bafy-A/passport.json";
    const URI_B_META = "ipfs://bafy-B/passport.json";

    // Version 1 of the metadata is frozen and a voucher is issued for it (nonce = version).
    const a = await makeVoucher({
      registry: base.registry,
      signer: base.platformSigner,
      seller: base.seller.address,
      listingId: LISTING_A,
      uri: URI_A,
      metadataHash: METADATA_A,
      termsHash: TERMS_HASH,
      nonce: 1n,
    });
    // The seller re-freezes; the new version gets its own nonce, so the voucher differs entirely.
    const b = await makeVoucher({
      registry: base.registry,
      signer: base.platformSigner,
      seller: base.seller.address,
      listingId: LISTING_A,
      uri: URI_B_META,
      metadataHash: METADATA_B,
      termsHash: TERMS_HASH,
      nonce: 2n,
    });

    // Current metadata mints normally.
    await expect(
      base.registry.connect(base.seller).mintPassport(b.voucher, URI_B_META, b.signature),
    )
      .to.emit(base.registry, "PassportMinted")
      .withArgs(1n, base.seller.address, LISTING_A, URI_B_META, METADATA_B, TERMS_HASH);

    // The superseded voucher for version 1 is now dead: one passport per listing, forever.
    await expect(
      base.registry.connect(base.seller).mintPassport(a.voucher, URI_A, a.signature),
    ).to.be.revertedWithCustomError(base.registry, "ListingAlreadyMinted");

    // And what is stored on chain is the current metadata, not the superseded version.
    expect(await base.registry.tokenURI(1n)).to.equal(URI_B_META);
    expect((await base.registry.passport(1n)).metadataHash).to.equal(METADATA_B);
  });

  it("mints normally with a valid current voucher after an earlier one expired unused", async () => {
    const base = await deployFixture();
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const stale = await makeVoucher({
      registry: base.registry,
      signer: base.platformSigner,
      seller: base.seller.address,
      listingId: LISTING_A,
      uri: URI,
      metadataHash: META_HASH,
      termsHash: TERMS_HASH,
      nonce: 1n,
      expiry: BigInt(now + 120),
    });
    await ethers.provider.send("evm_increaseTime", [3600]);
    await ethers.provider.send("evm_mine", []);
    await expect(
      base.registry.connect(base.seller).mintPassport(stale.voucher, URI, stale.signature),
    ).to.be.revertedWithCustomError(base.registry, "VoucherExpired");

    // Re-freezing after expiry issues nonce 2, which mints without any trouble.
    const fresh = await makeVoucher({
      registry: base.registry,
      signer: base.platformSigner,
      seller: base.seller.address,
      listingId: LISTING_A,
      uri: URI,
      metadataHash: META_HASH,
      termsHash: TERMS_HASH,
      nonce: 2n,
    });
    await expect(
      base.registry.connect(base.seller).mintPassport(fresh.voucher, URI, fresh.signature),
    ).to.emit(base.registry, "PassportMinted");
  });

  it("ADVERSARIAL: cross-chain and cross-contract signatures are rejected", async () => {
    const base = await deployFixture();
    await expect(mintFor(base, base.seller, { chainId: 1n })).to.be.revertedWithCustomError(
      base.registry,
      "InvalidVoucherSignature",
    );
    const Registry = await ethers.getContractFactory("YardSaleAssetRegistry");
    const otherRegistry = await Registry.deploy(base.admin.address);
    await expect(
      mintFor(base, base.seller, { verifyingContract: await otherRegistry.getAddress() }),
    ).to.be.revertedWithCustomError(base.registry, "InvalidVoucherSignature");
  });

  it("ADVERSARIAL: a revoked signer's vouchers stop working", async () => {
    const base = await deployFixture();
    await base.registry
      .connect(base.admin)
      .revokeRole(await base.registry.SIGNER_ROLE(), base.platformSigner.address);
    await expect(mintFor(base, base.seller)).to.be.revertedWithCustomError(
      base.registry,
      "InvalidVoucherSignature",
    );
  });

  it("rejects expired vouchers", async () => {
    const base = await deployFixture();
    const now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
    await expect(mintFor(base, base.seller, { expiry: now - 1n })).to.be.revertedWithCustomError(
      base.registry,
      "VoucherExpired",
    );
  });

  it("rejects a metadata URI that does not match the signed URI hash", async () => {
    const base = await deployFixture();
    await expect(
      mintFor(base, base.seller, { sentURI: "ipfs://swapped.json" }),
    ).to.be.revertedWithCustomError(base.registry, "VoucherURIMismatch");
  });

  it("has no setter for URI or hashes after mint", async () => {
    const { registry } = await deployFixture();
    const fns = registry.interface.fragments
      .filter((f) => f.type === "function")
      .map((f) => f.name);
    for (const banned of [
      "setTokenURI",
      "setMetadataHash",
      "setTermsHash",
      "updatePassport",
      "burn",
    ]) {
      expect(fns).to.not.include(banned);
    }
  });

  it("allows only one mint per listing", async () => {
    const base = await deployFixture();
    await mintFor(base, base.seller);
    await expect(mintFor(base, base.other, { seller: base.other.address, nonce: 1n }))
      .to.be.revertedWithCustomError(base.registry, "ListingAlreadyMinted")
      .withArgs(LISTING_A);
  });

  it("rejects empty inputs", async () => {
    const base = await deployFixture();
    const { registry, seller } = base;
    await expect(
      mintFor(base, seller, { listingId: ethers.ZeroHash }),
    ).to.be.revertedWithCustomError(registry, "EmptyListingId");
    await expect(mintFor(base, seller, { uri: "" })).to.be.revertedWithCustomError(
      registry,
      "EmptyMetadataURI",
    );
    await expect(
      mintFor(base, seller, { metadataHash: ethers.ZeroHash }),
    ).to.be.revertedWithCustomError(registry, "EmptyHash");
    await expect(
      mintFor(base, seller, { termsHash: ethers.ZeroHash }),
    ).to.be.revertedWithCustomError(registry, "EmptyHash");
  });

  it("rejects a zero admin", async () => {
    const Registry = await ethers.getContractFactory("YardSaleAssetRegistry");
    await expect(Registry.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(
      Registry,
      "ZeroAddress",
    );
  });

  it("enforces a forward-only status transition matrix", async () => {
    const base = await mintedFixture();
    const { registry, admin, seller } = base;
    const [LISTED, RESERVED, COLLECTED, WITHDRAWN, DISPUTED] = [0, 1, 2, 3, 4];

    await expect(registry.connect(seller).setStatus(1n, RESERVED)).to.be.revertedWithCustomError(
      registry,
      "AccessControlUnauthorizedAccount",
    );
    // Listed -> Collected is not a legal jump.
    await expect(registry.connect(admin).setStatus(1n, COLLECTED))
      .to.be.revertedWithCustomError(registry, "InvalidStatusTransition")
      .withArgs(1n, LISTED, COLLECTED);

    await expect(registry.connect(admin).setStatus(1n, RESERVED))
      .to.emit(registry, "PassportStatusChanged")
      .withArgs(1n, LISTED, RESERVED);
    // Backwards is rejected.
    await expect(registry.connect(admin).setStatus(1n, LISTED)).to.be.revertedWithCustomError(
      registry,
      "InvalidStatusTransition",
    );
    await expect(registry.connect(admin).setStatus(1n, RESERVED)).to.be.revertedWithCustomError(
      registry,
      "StatusUnchanged",
    );
    await registry.connect(admin).setStatus(1n, COLLECTED);
    await expect(registry.connect(admin).setStatus(1n, WITHDRAWN)).to.be.revertedWithCustomError(
      registry,
      "InvalidStatusTransition",
    );
    await registry.connect(admin).setStatus(1n, DISPUTED);
    await registry.connect(admin).setStatus(1n, WITHDRAWN);
    // Withdrawn is terminal.
    for (const s of [LISTED, RESERVED, COLLECTED, DISPUTED]) {
      await expect(registry.connect(admin).setStatus(1n, s)).to.be.revertedWithCustomError(
        registry,
        "InvalidStatusTransition",
      );
    }
    await expect(registry.connect(admin).setStatus(42n, RESERVED)).to.be.revertedWithCustomError(
      registry,
      "UnknownPassport",
    );
    expect(await registry.isValidTransition(LISTED, RESERVED)).to.equal(true);
    expect(await registry.isValidTransition(LISTED, LISTED)).to.equal(false);
    expect(await registry.isValidTransition(WITHDRAWN, LISTED)).to.equal(false);
  });

  it("pauses mints, transfers, status changes and pairing", async () => {
    const base = await mintedFixture();
    const { registry, seller, admin, other, factory } = base;
    await expect(registry.connect(seller).pause()).to.be.revertedWithCustomError(
      registry,
      "AccessControlUnauthorizedAccount",
    );
    await registry.connect(admin).pause();
    await expect(
      mintFor(base, seller, { listingId: LISTING_B, uri: URI_B, nonce: 1n }),
    ).to.be.revertedWithCustomError(registry, "EnforcedPause");
    await expect(
      registry.connect(seller).transferFrom(seller.address, other.address, 1n),
    ).to.be.revertedWithCustomError(registry, "EnforcedPause");
    await expect(registry.connect(admin).setStatus(1n, 1)).to.be.revertedWithCustomError(
      registry,
      "EnforcedPause",
    );
    await expect(
      factory.connect(seller).createCompanionToken(1n, "A", "A", 1000n, 1000n),
    ).to.be.revertedWithCustomError(registry, "EnforcedPause");
    await registry.connect(admin).unpause();
    await registry.connect(seller).transferFrom(seller.address, other.address, 1n);
    expect(await registry.ownerOf(1n)).to.equal(other.address);
  });

  it("reverts reads for unknown passports", async () => {
    const { registry } = await deployFixture();
    await expect(registry.passport(99n)).to.be.revertedWithCustomError(registry, "UnknownPassport");
    await expect(registry.companionTokenOf(99n)).to.be.revertedWithCustomError(
      registry,
      "UnknownPassport",
    );
    await expect(registry.tokenURI(99n)).to.be.revertedWithCustomError(registry, "UnknownPassport");
    expect(await registry.exists(99n)).to.equal(false);
  });

  it("pairs a companion token only from the pairing role, only once, only to a contract", async () => {
    const { registry, other, admin, factory } = await mintedFixture();
    await expect(
      registry.connect(other).setCompanionToken(1n, other.address),
    ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    await expect(
      registry.connect(admin).setCompanionToken(1n, other.address),
    ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    await registry.connect(admin).grantRole(await registry.PAIRING_ROLE(), admin.address);
    await expect(
      registry.connect(admin).setCompanionToken(1n, other.address),
    ).to.be.revertedWithCustomError(registry, "NotAContract");
    await expect(
      registry.connect(admin).setCompanionToken(1n, ethers.ZeroAddress),
    ).to.be.revertedWithCustomError(registry, "ZeroAddress");
    const factoryAddress = await factory.getAddress();
    await expect(registry.connect(admin).setCompanionToken(1n, factoryAddress))
      .to.emit(registry, "CompanionTokenPaired")
      .withArgs(1n, factoryAddress);
    await expect(
      registry.connect(admin).setCompanionToken(1n, factoryAddress),
    ).to.be.revertedWithCustomError(registry, "CompanionTokenAlreadySet");
  });

  it("blocks re-entrant minting through the ERC721 receiver hook", async () => {
    const base = await deployFixture();
    const { registry, platformSigner } = base;
    const Attacker = await ethers.getContractFactory("ReentrantMinter");
    const attacker = await Attacker.deploy(await registry.getAddress());
    const attackerAddress = await attacker.getAddress();

    const first = await makeVoucher({
      registry,
      signer: platformSigner,
      seller: attackerAddress,
      listingId: LISTING_A,
      uri: URI,
      metadataHash: META_HASH,
      termsHash: TERMS_HASH,
      nonce: 0n,
    });
    const second = await makeVoucher({
      registry,
      signer: platformSigner,
      seller: attackerAddress,
      listingId: LISTING_B,
      uri: URI_B,
      metadataHash: META_HASH,
      termsHash: TERMS_HASH,
      nonce: 1n,
    });

    await attacker.mint(
      first.voucher,
      URI,
      first.signature,
      second.voucher,
      URI_B,
      second.signature,
    );
    expect(await attacker.reentered()).to.equal(false);
    expect(await registry.totalMinted()).to.equal(1n);
    expect(await registry.passportOfListing(LISTING_B)).to.equal(0n);
    expect(await attacker.lastRevert()).to.equal(
      registry.interface.encodeErrorResult("ReentrancyGuardReentrantCall", []),
    );
  });

  it("supports ERC-721 and AccessControl interfaces", async () => {
    const { registry } = await deployFixture();
    expect(await registry.supportsInterface("0x80ac58cd")).to.equal(true); // ERC721
    expect(await registry.supportsInterface("0x5b5e139f")).to.equal(true); // ERC721Metadata
    expect(await registry.supportsInterface("0x7965db0b")).to.equal(true); // AccessControl
  });
});

describe("Role transfer and renounce", () => {
  it("hands admin roles to a new admin and lets the deployer renounce everything", async () => {
    const { registry, factory, admin, newAdmin, seller, treasury } = await deployFixture();
    const DEFAULT_ADMIN_ROLE = await registry.DEFAULT_ADMIN_ROLE();
    const PAUSER_ROLE = await registry.PAUSER_ROLE();
    const STATUS_ROLE = await registry.STATUS_ROLE();
    const SIGNER_ROLE = await registry.SIGNER_ROLE();

    await registry.connect(admin).grantRole(DEFAULT_ADMIN_ROLE, newAdmin.address);
    await registry.connect(admin).grantRole(PAUSER_ROLE, newAdmin.address);
    await registry.connect(admin).grantRole(STATUS_ROLE, newAdmin.address);
    await factory.connect(admin).grantRole(DEFAULT_ADMIN_ROLE, newAdmin.address);
    await factory.connect(admin).grantRole(await factory.PAUSER_ROLE(), newAdmin.address);

    for (const role of [SIGNER_ROLE, PAUSER_ROLE, STATUS_ROLE, DEFAULT_ADMIN_ROLE]) {
      await registry.connect(admin).renounceRole(role, admin.address);
      expect(await registry.hasRole(role, admin.address)).to.equal(false);
    }
    await factory.connect(admin).renounceRole(await factory.PAUSER_ROLE(), admin.address);
    await factory.connect(admin).renounceRole(DEFAULT_ADMIN_ROLE, admin.address);

    await expect(registry.connect(admin).pause()).to.be.revertedWithCustomError(
      registry,
      "AccessControlUnauthorizedAccount",
    );
    await expect(
      registry.connect(admin).grantRole(PAUSER_ROLE, admin.address),
    ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    await expect(factory.connect(admin).setTreasury(seller.address)).to.be.revertedWithCustomError(
      factory,
      "AccessControlUnauthorizedAccount",
    );

    await registry.connect(newAdmin).pause();
    await registry.connect(newAdmin).unpause();
    await factory.connect(newAdmin).pause();
    await factory.connect(newAdmin).unpause();
    await expect(factory.connect(newAdmin).setTreasury(seller.address))
      .to.emit(factory, "TreasuryUpdated")
      .withArgs(treasury.address, seller.address);
    expect(
      await registry.hasRole(await registry.PAIRING_ROLE(), await factory.getAddress()),
    ).to.equal(true);
  });

  it("cannot renounce a role for someone else", async () => {
    const { registry, admin, other } = await deployFixture();
    await expect(
      registry.connect(other).renounceRole(await registry.DEFAULT_ADMIN_ROLE(), admin.address),
    ).to.be.revertedWithCustomError(registry, "AccessControlBadConfirmation");
  });
});

describe("YardTokenFactory + YardCompanionToken", () => {
  it("creates a fixed-supply clone paired to the passport", async () => {
    const { factory, registry, seller, treasury, impl } = await mintedFixture();
    const supply = ethers.parseUnits("1000000", 18);
    const allocation = ethers.parseUnits("700000", 18);
    const predicted = await factory.predictTokenAddress(1n);

    await expect(
      factory.connect(seller).createCompanionToken(1n, "Teak Desk", "TEAK", supply, allocation),
    )
      .to.emit(factory, "CompanionTokenCreated")
      .withArgs(1n, predicted, seller.address, "Teak Desk", "TEAK", supply, allocation)
      .and.to.emit(registry, "CompanionTokenPaired")
      .withArgs(1n, predicted);

    const token = await ethers.getContractAt("YardCompanionToken", predicted);
    expect(await token.name()).to.equal("Teak Desk");
    expect(await token.symbol()).to.equal("TEAK");
    expect(await token.decimals()).to.equal(18n);
    expect(await token.totalSupply()).to.equal(supply);
    expect(await token.balanceOf(seller.address)).to.equal(allocation);
    expect(await token.balanceOf(treasury.address)).to.equal(supply - allocation);
    expect(await token.passportTokenId()).to.equal(1n);
    expect(await token.creator()).to.equal(seller.address);
    expect(await token.factory()).to.equal(await factory.getAddress());
    expect(await token.registry()).to.equal(await registry.getAddress());
    expect(await registry.companionTokenOf(1n)).to.equal(predicted);
    expect(await factory.tokenForPassport(1n)).to.equal(predicted);
    expect(await factory.passportForToken(predicted)).to.equal(1n);
    expect(await factory.isCompanionToken(predicted)).to.equal(true);
    expect(await factory.isCompanionToken(await impl.getAddress())).to.equal(false);

    const code = await ethers.provider.getCode(predicted);
    const implHex = (await impl.getAddress()).slice(2).toLowerCase();
    expect(code.toLowerCase()).to.equal(
      `0x363d3d373d3d3d363d73${implHex}5af43d82803e903d91602b57fd5bf3`,
    );
  });

  it("ADVERSARIAL: never allows a second token for the same passport", async () => {
    const { factory, seller } = await mintedFixture();
    const supply = ethers.parseUnits("1000", 18);
    await factory.connect(seller).createCompanionToken(1n, "A", "A", supply, supply);
    await expect(
      factory.connect(seller).createCompanionToken(1n, "B", "B", supply, supply),
    ).to.be.revertedWithCustomError(factory, "PassportAlreadyTokenized");
  });

  it("refuses a second token even if the registry was paired out of band", async () => {
    const { factory, registry, admin, seller } = await mintedFixture();
    await registry.connect(admin).grantRole(await registry.PAIRING_ROLE(), admin.address);
    await registry.connect(admin).setCompanionToken(1n, await factory.getAddress());
    await expect(
      factory.connect(seller).createCompanionToken(1n, "B", "B", 1000n, 1000n),
    ).to.be.revertedWithCustomError(factory, "PassportAlreadyTokenized");
  });

  it("only the passport owner can tokenize, including after transfer", async () => {
    const { factory, registry, seller, other } = await mintedFixture();
    const supply = ethers.parseUnits("1000", 18);
    await expect(
      factory.connect(other).createCompanionToken(1n, "A", "A", supply, supply),
    ).to.be.revertedWithCustomError(factory, "NotPassportOwner");
    await registry.connect(seller).transferFrom(seller.address, other.address, 1n);
    await expect(
      factory.connect(seller).createCompanionToken(1n, "A", "A", supply, supply),
    ).to.be.revertedWithCustomError(factory, "NotPassportOwner");
    await expect(factory.connect(other).createCompanionToken(1n, "A", "A", supply, supply)).to.emit(
      factory,
      "CompanionTokenCreated",
    );
  });

  it("rejects contract callers that do not own the passport", async () => {
    const { factory } = await mintedFixture();
    const Caller = await ethers.getContractFactory("ContractCaller");
    const caller = await Caller.deploy();
    await expect(caller.callFactory(await factory.getAddress(), 1n)).to.be.revertedWithCustomError(
      factory,
      "NotPassportOwner",
    );
  });

  it("rejects unknown passports", async () => {
    const { factory, registry, seller } = await mintedFixture();
    await expect(
      factory.connect(seller).createCompanionToken(77n, "A", "A", 1000n, 1000n),
    ).to.be.revertedWithCustomError(registry, "ERC721NonexistentToken");
  });

  it("validates token inputs", async () => {
    const { factory, seller, impl } = await mintedFixture();
    const supply = ethers.parseUnits("1000", 18);
    await expect(
      factory.connect(seller).createCompanionToken(1n, "", "A", supply, supply),
    ).to.be.revertedWithCustomError(factory, "EmptyName");
    await expect(
      factory.connect(seller).createCompanionToken(1n, "A", "", supply, supply),
    ).to.be.revertedWithCustomError(factory, "EmptySymbol");
    await expect(
      factory.connect(seller).createCompanionToken(1n, "x".repeat(65), "A", supply, supply),
    ).to.be.revertedWithCustomError(factory, "NameTooLong");
    await expect(
      factory.connect(seller).createCompanionToken(1n, "A", "x".repeat(17), supply, supply),
    ).to.be.revertedWithCustomError(factory, "SymbolTooLong");
    await expect(
      factory.connect(seller).createCompanionToken(1n, "A", "A", 0, 0),
    ).to.be.revertedWithCustomError(impl, "ZeroSupply");
    await expect(
      factory.connect(seller).createCompanionToken(1n, "A", "A", supply, 0),
    ).to.be.revertedWithCustomError(impl, "InvalidAllocation");
    await expect(
      factory.connect(seller).createCompanionToken(1n, "A", "A", supply, supply + 1n),
    ).to.be.revertedWithCustomError(impl, "InvalidAllocation");
    const max = await impl.MAX_SUPPLY();
    await expect(
      factory.connect(seller).createCompanionToken(1n, "A", "A", max + 1n, 1n),
    ).to.be.revertedWithCustomError(impl, "SupplyTooLarge");
    await expect(factory.connect(seller).createCompanionToken(1n, "A", "A", max, max)).to.emit(
      factory,
      "CompanionTokenCreated",
    );
  });

  it("validates factory constructor arguments", async () => {
    const { registry, treasury, impl, admin } = await deployFixture();
    const Factory = await ethers.getContractFactory("YardTokenFactory");
    const registryAddress = await registry.getAddress();
    const implAddress = await impl.getAddress();
    await expect(
      Factory.deploy(ethers.ZeroAddress, registryAddress, treasury.address, implAddress),
    ).to.be.revertedWithCustomError(Factory, "ZeroAddress");
    await expect(
      Factory.deploy(admin.address, ethers.ZeroAddress, treasury.address, implAddress),
    ).to.be.revertedWithCustomError(Factory, "ZeroAddress");
    await expect(
      Factory.deploy(admin.address, registryAddress, ethers.ZeroAddress, implAddress),
    ).to.be.revertedWithCustomError(Factory, "ZeroAddress");
    await expect(
      Factory.deploy(admin.address, registryAddress, treasury.address, ethers.ZeroAddress),
    ).to.be.revertedWithCustomError(Factory, "ZeroAddress");
    await expect(
      Factory.deploy(admin.address, treasury.address, treasury.address, implAddress),
    ).to.be.revertedWithCustomError(Factory, "NotAContract");
    await expect(
      Factory.deploy(admin.address, registryAddress, treasury.address, treasury.address),
    ).to.be.revertedWithCustomError(Factory, "NotAContract");
  });

  it("fails cleanly when the factory lacks PAIRING_ROLE", async () => {
    const base = await deployFixture();
    const { registry, seller, treasury, impl, admin } = base;
    const Factory = await ethers.getContractFactory("YardTokenFactory");
    const rogue = await Factory.deploy(
      admin.address,
      await registry.getAddress(),
      treasury.address,
      await impl.getAddress(),
    );
    await mintFor(base, seller);
    await expect(
      rogue.connect(seller).createCompanionToken(1n, "A", "A", 1000n, 1000n),
    ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    expect(await registry.companionTokenOf(1n)).to.equal(ethers.ZeroAddress);
    expect(await rogue.tokenForPassport(1n)).to.equal(ethers.ZeroAddress);
  });

  it("exposes no minting, tax, blacklist, owner, or upgrade surface", async () => {
    const { factory, seller } = await mintedFixture();
    const supply = ethers.parseUnits("1000", 18);
    await factory.connect(seller).createCompanionToken(1n, "A", "A", supply, supply);
    const token = await ethers.getContractAt(
      "YardCompanionToken",
      await factory.tokenForPassport(1n),
    );
    const fns = token.interface.fragments.filter((f) => f.type === "function").map((f) => f.name);
    for (const banned of [
      "mint",
      "burn",
      "burnFrom",
      "setTax",
      "setFee",
      "setFees",
      "blacklist",
      "setBlacklist",
      "owner",
      "transferOwnership",
      "rebase",
      "upgradeTo",
      "upgradeToAndCall",
      "pause",
      "unpause",
      "claim",
      "redeem",
      "distribute",
      "snapshot",
    ]) {
      expect(fns, `${banned} must not exist`).to.not.include(banned);
    }
    expect(fns.sort()).to.deep.equal(
      [
        "MAX_SUPPLY",
        "RIGHTS_DISCLAIMER",
        "allowance",
        "approve",
        "balanceOf",
        "creator",
        "decimals",
        "factory",
        "initialize",
        "name",
        "passportTokenId",
        "registry",
        "symbol",
        "totalSupply",
        "transfer",
        "transferFrom",
      ].sort(),
    );
    expect(await token.RIGHTS_DISCLAIMER()).to.contain("no ownership");
  });

  it("cannot be re-initialized and the implementation itself is locked", async () => {
    const { factory, seller, treasury, registry, impl } = await mintedFixture();
    const supply = ethers.parseUnits("1000", 18);
    await factory.connect(seller).createCompanionToken(1n, "A", "A", supply, supply);
    const token = await ethers.getContractAt(
      "YardCompanionToken",
      await factory.tokenForPassport(1n),
    );
    const args = [
      "X",
      "X",
      supply,
      supply,
      seller.address,
      treasury.address,
      await registry.getAddress(),
      1n,
    ];
    await expect(token.connect(seller).initialize(...args)).to.be.revertedWithCustomError(
      token,
      "InvalidInitialization",
    );
    await expect(impl.connect(seller).initialize(...args)).to.be.revertedWithCustomError(
      impl,
      "InvalidInitialization",
    );
    expect(await impl.totalSupply()).to.equal(0n);
  });

  it("keeps total supply fixed through transfers and approvals", async () => {
    const { factory, seller, other, treasury } = await mintedFixture();
    const supply = ethers.parseUnits("1000", 18);
    const allocation = ethers.parseUnits("600", 18);
    await factory.connect(seller).createCompanionToken(1n, "A", "A", supply, allocation);
    const token = await ethers.getContractAt(
      "YardCompanionToken",
      await factory.tokenForPassport(1n),
    );
    await token.connect(seller).transfer(other.address, allocation / 2n);
    await token.connect(seller).approve(other.address, allocation / 2n);
    await token.connect(other).transferFrom(seller.address, other.address, allocation / 2n);
    expect(await token.balanceOf(seller.address)).to.equal(0n);
    expect(await token.balanceOf(other.address)).to.equal(allocation);
    expect(await token.balanceOf(treasury.address)).to.equal(supply - allocation);
    expect(await token.totalSupply()).to.equal(supply);
    await expect(
      token.connect(other).transfer(seller.address, allocation + 1n),
    ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
  });

  it("pauses token creation only via PAUSER_ROLE", async () => {
    const { factory, admin, seller } = await mintedFixture();
    await expect(factory.connect(seller).pause()).to.be.revertedWithCustomError(
      factory,
      "AccessControlUnauthorizedAccount",
    );
    await factory.connect(admin).pause();
    const supply = ethers.parseUnits("1000", 18);
    await expect(
      factory.connect(seller).createCompanionToken(1n, "A", "A", supply, supply),
    ).to.be.revertedWithCustomError(factory, "EnforcedPause");
    await factory.connect(admin).unpause();
    await expect(
      factory.connect(seller).createCompanionToken(1n, "A", "A", supply, supply),
    ).to.emit(factory, "CompanionTokenCreated");
  });

  it("gives each passport a distinct deterministic token address", async () => {
    const base = await mintedFixture();
    const { factory, seller } = base;
    await mintFor(base, seller, { listingId: LISTING_B, uri: URI_B, nonce: 1n });
    const a = await factory.predictTokenAddress(1n);
    const b = await factory.predictTokenAddress(2n);
    expect(a).to.not.equal(b);
    await factory.connect(seller).createCompanionToken(1n, "A", "A", 10n, 10n);
    await factory.connect(seller).createCompanionToken(2n, "B", "B", 10n, 10n);
    expect(await factory.tokenForPassport(1n)).to.equal(a);
    expect(await factory.tokenForPassport(2n)).to.equal(b);
  });

  it("rejects a zero treasury update", async () => {
    const { factory, admin } = await deployFixture();
    await expect(
      factory.connect(admin).setTreasury(ethers.ZeroAddress),
    ).to.be.revertedWithCustomError(factory, "ZeroAddress");
  });
});
