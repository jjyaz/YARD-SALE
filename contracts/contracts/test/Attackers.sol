// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

/// Test-only helpers. Never deployed to a live network.

interface IRegistryMint {
    struct MintVoucher {
        address seller;
        bytes32 listingId;
        bytes32 metadataURIHash;
        bytes32 metadataHash;
        bytes32 termsHash;
        uint256 nonce;
        uint256 expiry;
    }

    function mintPassport(MintVoucher calldata voucher, string calldata metadataURI, bytes calldata signature)
        external
        returns (uint256);
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

/// @dev Tries to re-enter mintPassport from the ERC721 receiver hook using a second valid voucher.
contract ReentrantMinter is IERC721Receiver {
    IRegistryMint public immutable registry;
    bool public reentered;
    bool public armed;
    bytes public lastRevert;

    IRegistryMint.MintVoucher private _second;
    string private _secondURI;
    bytes private _secondSig;

    constructor(address registry_) {
        registry = IRegistryMint(registry_);
    }

    function mint(
        IRegistryMint.MintVoucher calldata first,
        string calldata firstURI,
        bytes calldata firstSig,
        IRegistryMint.MintVoucher calldata second,
        string calldata secondURI,
        bytes calldata secondSig
    ) external {
        _second = second;
        _secondURI = secondURI;
        _secondSig = secondSig;
        armed = true;
        registry.mintPassport(first, firstURI, firstSig);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external override returns (bytes4) {
        if (armed) {
            armed = false;
            try registry.mintPassport(_second, _secondURI, _secondSig) {
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
