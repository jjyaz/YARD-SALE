const { ethers } = require("hardhat");

const VOUCHER_TYPES = {
  MintVoucher: [
    { name: "seller", type: "address" },
    { name: "listingId", type: "bytes32" },
    { name: "metadataURIHash", type: "bytes32" },
    { name: "metadataHash", type: "bytes32" },
    { name: "termsHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
};

async function domainFor(registryAddress, chainId) {
  const id = chainId ?? (await ethers.provider.getNetwork()).chainId;
  return {
    name: "YARD SALE Item Passport",
    version: "1",
    chainId: id,
    verifyingContract: registryAddress,
  };
}

/**
 * Builds and signs an EIP-712 mint voucher.
 * Overrides let adversarial tests forge cross-chain / cross-contract / wrong-signer variants.
 */
async function makeVoucher({
  registry,
  signer,
  seller,
  listingId,
  uri,
  metadataHash,
  termsHash,
  nonce = 0n,
  expiry,
  chainId,
  verifyingContract,
}) {
  const registryAddress = await registry.getAddress();
  const voucher = {
    seller,
    listingId,
    metadataURIHash: ethers.keccak256(ethers.toUtf8Bytes(uri)),
    metadataHash,
    termsHash,
    nonce,
    expiry: expiry ?? BigInt((await ethers.provider.getBlock("latest")).timestamp + 3600),
  };
  const domain = await domainFor(verifyingContract ?? registryAddress, chainId);
  const signature = await signer.signTypedData(domain, VOUCHER_TYPES, voucher);
  return { voucher, signature, uri };
}

module.exports = { VOUCHER_TYPES, domainFor, makeVoucher };
