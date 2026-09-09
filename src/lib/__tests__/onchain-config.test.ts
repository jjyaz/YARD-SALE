import { describe, expect, it } from "vitest";
import { keccak256, toBytes } from "viem";

import {
  ROBINHOOD_MAINNET_ID,
  ROBINHOOD_TESTNET_ID,
  isHexAddress,
  isSupportedChainId,
} from "@/config/env";
import { ERC721_INTERFACE_ID, erc1167Bytecode, isErc1167CloneOf } from "@/lib/abi";
import {
  UNISWAP_FEE_TIER,
  UNISWAP_TICK_SPACING,
  chainById,
  explorerTxUrl,
  uniswapMainnet,
} from "@/lib/chain";
import { base32Encode, cidV1Raw, cidV1RawFromDigest, ipfsGatewayUrl, isIpfsUri } from "@/lib/ipfs";

describe("chain configuration", () => {
  it("only supports Robinhood Chain mainnet and testnet", () => {
    expect(ROBINHOOD_MAINNET_ID).toBe(4663);
    expect(ROBINHOOD_TESTNET_ID).toBe(46630);
    expect(isSupportedChainId(4663)).toBe(true);
    expect(isSupportedChainId(46630)).toBe(true);
    expect(isSupportedChainId(1)).toBe(false);
    expect(isSupportedChainId(8453)).toBe(false);
  });

  it("resolves chains and Blockscout explorer links", () => {
    expect(chainById(4663).name).toBe("Robinhood Chain");
    expect(chainById(46630).name).toContain("Testnet");
    expect(() => chainById(1)).toThrow();
    expect(explorerTxUrl(4663, "0xabc")).toBe("https://robinhoodchain.blockscout.com/tx/0xabc");
    expect(explorerTxUrl(46630, "0xabc")).toBe(
      "https://explorer.testnet.chain.robinhood.com/tx/0xabc",
    );
  });

  it("pins the official Robinhood Chain Uniswap v3 deployment", () => {
    expect(uniswapMainnet.factory.toLowerCase()).toBe("0x1f7d7550b1b028f7571e69a784071f0205fd2efa");
    expect(uniswapMainnet.positionManager.toLowerCase()).toBe(
      "0x73991a25c818bf1f1128deaab1492d45638de0d3",
    );
    expect(uniswapMainnet.weth.toLowerCase()).toBe("0x0bd7d308f8e1639fab988df18a8011f41eacad73");
    expect(UNISWAP_FEE_TIER).toBe(3000);
    expect(UNISWAP_TICK_SPACING).toBe(60);
  });
});

describe("address validation", () => {
  it("accepts 20-byte hex addresses only", () => {
    expect(isHexAddress("0x0bd7d308f8e1639fab988df18a8011f41eacad73")).toBe(true);
    expect(isHexAddress("0x0BD7D308F8E1639FAB988DF18A8011F41EACAD73")).toBe(true);
    expect(isHexAddress("0bd7d308f8e1639fab988df18a8011f41eacad73")).toBe(false);
    expect(isHexAddress("0x0bd7d308f8e1639fab988df18a8011f41eacad7")).toBe(false);
    expect(isHexAddress("0xZZd7d308f8e1639fab988df18a8011f41eacad73")).toBe(false);
    expect(isHexAddress("")).toBe(false);
  });
});

describe("ERC-1167 clone verification", () => {
  const impl = "0x1234567890abcdef1234567890abcdef12345678";

  it("builds the canonical 45-byte minimal proxy runtime", () => {
    const code = erc1167Bytecode(impl);
    expect(code).toBe(
      "0x363d3d373d3d3d363d731234567890abcdef1234567890abcdef12345678" +
        "5af43d82803e903d91602b57fd5bf3",
    );
    expect((code.length - 2) / 2).toBe(45);
    expect(ERC721_INTERFACE_ID).toBe("0x80ac58cd");
  });

  it("only accepts byte-exact clones of the expected implementation", () => {
    const code = erc1167Bytecode(impl);
    expect(isErc1167CloneOf(code, impl)).toBe(true);
    expect(isErc1167CloneOf(code.toUpperCase().replace("0X", "0x"), impl)).toBe(true);
    expect(isErc1167CloneOf(code, "0x1234567890abcdef1234567890abcdef12345679")).toBe(false);
    expect(isErc1167CloneOf(`${code}00`, impl)).toBe(false);
    expect(isErc1167CloneOf("0x", impl)).toBe(false);
    expect(isErc1167CloneOf(undefined, impl)).toBe(false);
    expect(() => erc1167Bytecode("0x123")).toThrow();
  });
});

describe("terms hashing", () => {
  it("hashes the 2026-09-01 terms body to the value stored on-chain", () => {
    const body =
      "YARD SALE listing and pickup terms, version 2026-09-01. Local pickup only. Sellers must own or be authorized to sell the item. Item Passports are records and contractual claim rights, not government title.";
    expect(keccak256(toBytes(body))).toBe(
      "0x473d0eeaaf7b4ec251c2bf167e865d0e5e1c9d15574572e2cd93c62367efb8a3",
    );
  });
});

describe("IPFS CIDv1 (raw, sha2-256, base32)", () => {
  it("encodes base32 lower-case without padding", () => {
    expect(base32Encode(new Uint8Array([]))).toBe("");
    expect(base32Encode(new TextEncoder().encode("f"))).toBe("my");
    expect(base32Encode(new TextEncoder().encode("foobar"))).toBe("mzxw6ytboi");
  });

  it("matches the reference CID for 'hello world'", async () => {
    const cid = await cidV1Raw(new TextEncoder().encode("hello world"));
    expect(cid).toBe("bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e");
  });

  it("builds the same CID from a precomputed digest", async () => {
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode("hello world")),
    );
    expect(cidV1RawFromDigest(digest)).toBe(
      "bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e",
    );
    expect(() => cidV1RawFromDigest(new Uint8Array(31))).toThrow();
  });

  it("maps ipfs:// URIs to a gateway and leaves other URIs alone", () => {
    expect(isIpfsUri("ipfs://bafy")).toBe(true);
    expect(isIpfsUri("https://x/y.json")).toBe(false);
    expect(ipfsGatewayUrl("ipfs://bafy", "https://ipfs.io/ipfs")).toBe("https://ipfs.io/ipfs/bafy");
    expect(ipfsGatewayUrl("ipfs://bafy", "https://ipfs.io/ipfs/")).toBe(
      "https://ipfs.io/ipfs/bafy",
    );
    expect(ipfsGatewayUrl("https://x/y.json", "https://ipfs.io/ipfs")).toBe("https://x/y.json");
  });
});
