const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const DAY = 24 * 60 * 60;
const MIN_LOCK = 180 * DAY;

async function fixture() {
  const [depositor, stranger] = await ethers.getSigners();
  const Positions = await ethers.getContractFactory("MockPositionManager");
  const positions = await Positions.deploy();
  const Locker = await ethers.getContractFactory("YardLiquidityLocker");
  const locker = await Locker.deploy(await positions.getAddress());
  await positions.mint(depositor.address, 1n);
  await positions.mint(depositor.address, 2n);
  return { depositor, stranger, positions, locker };
}

describe("YardLiquidityLocker", () => {
  it("rejects a zero or non-contract position manager", async () => {
    const Locker = await ethers.getContractFactory("YardLiquidityLocker");
    const [a] = await ethers.getSigners();
    await expect(Locker.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(
      Locker,
      "ZeroAddress",
    );
    await expect(Locker.deploy(a.address)).to.be.revertedWithCustomError(Locker, "NotAContract");
  });

  it("locks a position for at least 180 days and reports it as locked", async () => {
    const { locker, positions, depositor } = await fixture();
    await positions.connect(depositor).approve(await locker.getAddress(), 1n);
    await expect(locker.connect(depositor).lock(1n, MIN_LOCK, false)).to.emit(
      locker,
      "PositionLocked",
    );
    expect(await positions.ownerOf(1n)).to.equal(await locker.getAddress());
    expect(await locker.isLocked(1n)).to.equal(true);
    const info = await locker.lockInfo(1n);
    expect(info.depositor).to.equal(depositor.address);
    expect(info.permanent).to.equal(false);
    expect(info.unlockAt - info.lockedAt).to.equal(BigInt(MIN_LOCK));
  });

  it("ADVERSARIAL: rejects a lock shorter than 180 days", async () => {
    const { locker, positions, depositor } = await fixture();
    await positions.connect(depositor).approve(await locker.getAddress(), 1n);
    await expect(locker.connect(depositor).lock(1n, MIN_LOCK - 1, false))
      .to.be.revertedWithCustomError(locker, "LockDurationTooShort")
      .withArgs(MIN_LOCK - 1, MIN_LOCK);
  });

  it("ADVERSARIAL: early withdrawal fails, and withdrawal by a stranger fails", async () => {
    const { locker, positions, depositor, stranger } = await fixture();
    await positions.connect(depositor).approve(await locker.getAddress(), 1n);
    await locker.connect(depositor).lock(1n, MIN_LOCK, false);
    await expect(locker.connect(depositor).withdraw(1n)).to.be.revertedWithCustomError(
      locker,
      "StillLocked",
    );
    await time.increase(MIN_LOCK + 1);
    await expect(locker.connect(stranger).withdraw(1n)).to.be.revertedWithCustomError(
      locker,
      "NotDepositor",
    );
    await expect(locker.connect(depositor).withdraw(1n)).to.emit(locker, "PositionWithdrawn");
    expect(await positions.ownerOf(1n)).to.equal(depositor.address);
    expect(await locker.isLocked(1n)).to.equal(false);
    await expect(locker.connect(depositor).withdraw(1n)).to.be.revertedWithCustomError(
      locker,
      "AlreadyWithdrawn",
    );
  });

  it("ADVERSARIAL: a permanent lock can never be withdrawn", async () => {
    const { locker, positions, depositor } = await fixture();
    await positions.connect(depositor).approve(await locker.getAddress(), 1n);
    await locker.connect(depositor).lock(1n, 0, true);
    await time.increase(3650 * DAY);
    await expect(locker.connect(depositor).withdraw(1n)).to.be.revertedWithCustomError(
      locker,
      "PermanentLock",
    );
    expect(await positions.ownerOf(1n)).to.equal(await locker.getAddress());
  });

  it("has no administrator bypass surface", async () => {
    const { locker } = await fixture();
    const fns = locker.interface.fragments.filter((f) => f.type === "function").map((f) => f.name);
    for (const banned of [
      "owner",
      "transferOwnership",
      "grantRole",
      "renounceRole",
      "pause",
      "sweep",
      "rescue",
      "emergencyWithdraw",
      "setUnlockAt",
      "upgradeTo",
    ]) {
      expect(fns, `${banned} must not exist`).to.not.include(banned);
    }
  });

  it("accepts a direct safeTransferFrom carrying lock data and rejects other collections", async () => {
    const { locker, positions, depositor } = await fixture();
    const data = ethers.AbiCoder.defaultAbiCoder().encode(["uint64", "bool"], [MIN_LOCK, false]);
    await expect(
      positions
        .connect(depositor)
        ["safeTransferFrom(address,address,uint256,bytes)"](
          depositor.address,
          await locker.getAddress(),
          2n,
          data,
        ),
    ).to.emit(locker, "PositionLocked");
    expect(await locker.isLocked(2n)).to.equal(true);

    const Other = await ethers.getContractFactory("MockPositionManager");
    const other = await Other.deploy();
    await other.mint(depositor.address, 9n);
    await expect(
      other
        .connect(depositor)
        ["safeTransferFrom(address,address,uint256,bytes)"](
          depositor.address,
          await locker.getAddress(),
          9n,
          data,
        ),
    ).to.be.revertedWithCustomError(locker, "UnexpectedCollection");
  });

  it("reverts reads for unknown locks", async () => {
    const { locker } = await fixture();
    await expect(locker.lockInfo(99n)).to.be.revertedWithCustomError(locker, "UnknownLock");
    expect(await locker.isLocked(99n)).to.equal(false);
    await expect(locker.withdraw(99n)).to.be.revertedWithCustomError(locker, "UnknownLock");
  });

  it("ADVERSARIAL: a position id can never be recorded twice, even after withdrawal", async () => {
    const { locker, positions, depositor } = await fixture();
    const addr = await locker.getAddress();
    const data = ethers.AbiCoder.defaultAbiCoder().encode(["uint64", "bool"], [MIN_LOCK, false]);
    await positions.connect(depositor).approve(addr, 1n);
    await locker.connect(depositor).lock(1n, MIN_LOCK, false);

    await expect(locker.connect(depositor).lock(1n, MIN_LOCK, false)).to.be.revertedWithCustomError(
      locker,
      "PositionAlreadyRecorded",
    );

    await time.increase(MIN_LOCK + 1);
    await locker.connect(depositor).withdraw(1n);
    expect(await positions.ownerOf(1n)).to.equal(depositor.address);

    // Re-depositing a withdrawn position must revert instead of silently stranding the NFT.
    await expect(
      positions
        .connect(depositor)
        ["safeTransferFrom(address,address,uint256,bytes)"](depositor.address, addr, 1n, data),
    ).to.be.revertedWithCustomError(locker, "PositionAlreadyRecorded");
    await positions.connect(depositor).approve(addr, 1n);
    await expect(locker.connect(depositor).lock(1n, MIN_LOCK, false)).to.be.revertedWithCustomError(
      locker,
      "PositionAlreadyRecorded",
    );
    expect(await positions.ownerOf(1n)).to.equal(depositor.address);
  });

  it("lets only the depositor collect fees, always to the depositor", async () => {
    const { locker, positions, depositor, stranger } = await fixture();
    await positions.connect(depositor).approve(await locker.getAddress(), 1n);
    await locker.connect(depositor).lock(1n, MIN_LOCK, false);
    await positions.setOwed(1n, 500, 700);

    await expect(
      locker.connect(stranger).collectFees(1n, 10n ** 9n, 10n ** 9n),
    ).to.be.revertedWithCustomError(locker, "NotDepositor");
    await expect(locker.connect(depositor).collectFees(1n, 0, 0)).to.be.revertedWithCustomError(
      locker,
      "NothingToCollect",
    );

    await expect(locker.connect(depositor).collectFees(1n, 10n ** 9n, 10n ** 9n))
      .to.emit(locker, "FeesCollected")
      .withArgs(1n, depositor.address, 500n, 700n);
    expect(await positions.lastRecipient()).to.equal(depositor.address);
    const collected = await locker.collectedFees(1n);
    expect(collected[0]).to.equal(500n);
    expect(collected[1]).to.equal(700n);
    // Collecting fees never unwinds the lock.
    expect(await positions.ownerOf(1n)).to.equal(await locker.getAddress());
    expect(await locker.isLocked(1n)).to.equal(true);
  });

  it("ADVERSARIAL: fee collection reverts if it would reduce liquidity or move the NFT", async () => {
    const { locker, positions, depositor } = await fixture();
    await positions.connect(depositor).approve(await locker.getAddress(), 1n);
    await locker.connect(depositor).lock(1n, MIN_LOCK, false);
    await positions.setOwed(1n, 10, 10);

    await positions.setDrainLiquidityOnCollect(true);
    await expect(locker.connect(depositor).collectFees(1n, 10n, 10n)).to.be.revertedWithCustomError(
      locker,
      "LiquidityDecreased",
    );
    await positions.setDrainLiquidityOnCollect(false);

    await positions.setStealNftOnCollect(true);
    await expect(locker.connect(depositor).collectFees(1n, 10n, 10n)).to.be.revertedWithCustomError(
      locker,
      "PositionNotHeld",
    );
    await positions.setStealNftOnCollect(false);
    expect(await locker.isLocked(1n)).to.equal(true);
  });

  it("ADVERSARIAL: fees cannot be collected for an unknown or withdrawn position", async () => {
    const { locker, positions, depositor } = await fixture();
    await expect(locker.connect(depositor).collectFees(99n, 1n, 1n)).to.be.revertedWithCustomError(
      locker,
      "UnknownLock",
    );
    await positions.connect(depositor).approve(await locker.getAddress(), 1n);
    await locker.connect(depositor).lock(1n, MIN_LOCK, false);
    await time.increase(MIN_LOCK + 1);
    await locker.connect(depositor).withdraw(1n);
    await expect(locker.connect(depositor).collectFees(1n, 1n, 1n)).to.be.revertedWithCustomError(
      locker,
      "AlreadyWithdrawn",
    );
  });
});
