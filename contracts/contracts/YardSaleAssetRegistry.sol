// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title YardSaleAssetRegistry
 * @notice ERC-721 "Item Passport" registry for physical yard sale items.
 *
 *  - Exactly one passport may ever be minted for a given off-chain listing id.
 *  - Metadata URI, metadata hash and terms hash are immutable after mint.
 *  - Each passport carries a lifecycle status.
 *  - Each passport may be permanently paired with at most one companion token,
 *    and only by an address holding PAIRING_ROLE (the YardTokenFactory).
 *
 * A passport is a record of a listing. It is not a claim on the physical item,
 * and it carries no financial rights of any kind.
 */
contract YardSaleAssetRegistry is ERC721, AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant STATUS_ROLE = keccak256("STATUS_ROLE");
    bytes32 public constant PAIRING_ROLE = keccak256("PAIRING_ROLE");

    enum PassportStatus {
        Listed,
        Reserved,
        Collected,
        Withdrawn,
        Disputed
    }

    struct Passport {
        bytes32 listingId;
        bytes32 metadataHash;
        bytes32 termsHash;
        address companionToken;
        PassportStatus status;
        uint64 mintedAt;
    }

    uint256 private _nextTokenId = 1;

    mapping(uint256 => Passport) private _passports;
    mapping(uint256 => string) private _tokenURIs;
    mapping(bytes32 => uint256) public tokenIdForListing;

    error ListingAlreadyMinted(bytes32 listingId);
    error UnknownPassport(uint256 tokenId);
    error EmptyListingId();
    error EmptyMetadataURI();
    error EmptyHash();
    error ZeroAddress();
    error NotAContract(address account);
    error CompanionTokenAlreadySet(uint256 tokenId, address existing);
    error StatusUnchanged(uint256 tokenId);

    event PassportMinted(
        uint256 indexed tokenId,
        address indexed owner,
        bytes32 indexed listingId,
        string metadataURI,
        bytes32 metadataHash,
        bytes32 termsHash
    );
    event PassportStatusChanged(uint256 indexed tokenId, PassportStatus previousStatus, PassportStatus newStatus);
    event CompanionTokenPaired(uint256 indexed tokenId, address indexed companionToken);

    constructor(address admin) ERC721("YARD SALE Item Passport", "YARDP") {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(STATUS_ROLE, admin);
    }

    /// @notice Mints the single Item Passport allowed for `listingId`.
    /// @dev Sellers mint to themselves; MINTER_ROLE may mint on behalf of others.
    ///      nonReentrant closes the ERC721 receiver callback re-entry path.
    function mintPassport(
        address to,
        bytes32 listingId,
        string calldata metadataURI,
        bytes32 metadataHash,
        bytes32 termsHash
    ) external whenNotPaused nonReentrant returns (uint256 tokenId) {
        if (to == address(0)) revert ZeroAddress();
        if (listingId == bytes32(0)) revert EmptyListingId();
        if (bytes(metadataURI).length == 0) revert EmptyMetadataURI();
        if (metadataHash == bytes32(0) || termsHash == bytes32(0)) revert EmptyHash();
        if (tokenIdForListing[listingId] != 0) revert ListingAlreadyMinted(listingId);
        if (!hasRole(MINTER_ROLE, _msgSender()) && _msgSender() != to) {
            revert AccessControlUnauthorizedAccount(_msgSender(), MINTER_ROLE);
        }

        tokenId = _nextTokenId++;
        tokenIdForListing[listingId] = tokenId;
        _passports[tokenId] = Passport({
            listingId: listingId,
            metadataHash: metadataHash,
            termsHash: termsHash,
            companionToken: address(0),
            status: PassportStatus.Listed,
            mintedAt: uint64(block.timestamp)
        });
        _tokenURIs[tokenId] = metadataURI;
        _safeMint(to, tokenId);

        emit PassportMinted(tokenId, to, listingId, metadataURI, metadataHash, termsHash);
    }

    function setStatus(uint256 tokenId, PassportStatus newStatus) external onlyRole(STATUS_ROLE) whenNotPaused {
        _requireMinted(tokenId);
        PassportStatus previous = _passports[tokenId].status;
        if (previous == newStatus) revert StatusUnchanged(tokenId);
        _passports[tokenId].status = newStatus;
        emit PassportStatusChanged(tokenId, previous, newStatus);
    }

    /// @notice Permanently pairs one companion token with one passport. Callable once, by the factory.
    function setCompanionToken(uint256 tokenId, address companionToken)
        external
        onlyRole(PAIRING_ROLE)
        whenNotPaused
    {
        _requireMinted(tokenId);
        if (companionToken == address(0)) revert ZeroAddress();
        if (companionToken.code.length == 0) revert NotAContract(companionToken);
        address existing = _passports[tokenId].companionToken;
        if (existing != address(0)) revert CompanionTokenAlreadySet(tokenId, existing);
        _passports[tokenId].companionToken = companionToken;
        emit CompanionTokenPaired(tokenId, companionToken);
    }

    /// @notice Returns the passport token id for a listing, or 0 when none has been minted.
    function passportOfListing(bytes32 listingId) external view returns (uint256) {
        return tokenIdForListing[listingId];
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function passport(uint256 tokenId) external view returns (Passport memory) {
        _requireMinted(tokenId);
        return _passports[tokenId];
    }

    function companionTokenOf(uint256 tokenId) external view returns (address) {
        _requireMinted(tokenId);
        return _passports[tokenId].companionToken;
    }

    function exists(uint256 tokenId) external view returns (bool) {
        return _ownerOf(tokenId) != address(0);
    }

    function totalMinted() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireMinted(tokenId);
        return _tokenURIs[tokenId];
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function _requireMinted(uint256 tokenId) internal view {
        if (_ownerOf(tokenId) == address(0)) revert UnknownPassport(tokenId);
    }

    function _update(address to, uint256 tokenId, address auth) internal override whenNotPaused returns (address) {
        return super._update(to, tokenId, auth);
    }
}
