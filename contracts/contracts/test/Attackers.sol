// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

/// Test-only helpers. Never deployed to a live network.

interface IRegistryMint {
    function mintPassport(
        address to,
        bytes32 listingId,
        string calldata metadataURI,
        bytes32 metadataHash,
        bytes32 termsHash
    ) external returns (uint256);
}

interface IFactoryCreate {
    function createCompanionToken(
        uint256 passportTokenId,
        string calldata name_,
        string calldata symbol_,
        uint256 totalSupply_,
        uint256 creatorAllocation
    ) external returns (address);
}

/// @dev Tries to re-enter mintPassport from the ERC721 receiver hook.
contract ReentrantMinter is IERC721Receiver {
    IRegistryMint public immutable registry;
    bytes32 public nextListing;
    bool public reentered;
    bytes public lastRevert;

    constructor(address registry_) {
        registry = IRegistryMint(registry_);
    }

    function mint(bytes32 listingId, bytes32 second) external {
        nextListing = second;
        registry.mintPassport(address(this), listingId, "ipfs://a", keccak256("m"), keccak256("t"));
    }

    function onERC721Received(address, address, uint256, bytes calldata) external override returns (bytes4) {
        if (nextListing != bytes32(0)) {
            bytes32 target = nextListing;
            nextListing = bytes32(0);
            try registry.mintPassport(address(this), target, "ipfs://b", keccak256("m"), keccak256("t")) {
                reentered = true;
            } catch (bytes memory reason) {
                lastRevert = reason;
            }
        }
        return IERC721Receiver.onERC721Received.selector;
    }

    /// Lets the attacker (as passport owner) also call the factory, so ownership checks can be exercised.
    function createToken(address factory, uint256 tokenId) external returns (address) {
        return IFactoryCreate(factory).createCompanionToken(tokenId, "Bad", "BAD", 1e18, 1e18);
    }
}

/// @dev A contract that pretends to be a passport owner via a plain call from a contract account.
contract ContractCaller {
    function callFactory(address factory, uint256 tokenId) external returns (address) {
        return IFactoryCreate(factory).createCompanionToken(tokenId, "X", "X", 1e18, 1e18);
    }
}
