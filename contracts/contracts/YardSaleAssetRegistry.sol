// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title YardSaleAssetRegistry
 * @notice ERC-721 "Item Passport" registry for physical yard sale items.
 *
 *  - A passport can ONLY be minted with an EIP-712 mint voucher signed by an address holding
 *    SIGNER_ROLE (the platform signer). There is no unrestricted self-mint path, so an attacker
 *    cannot front-run a seller's public listing id and permanently block their listing.
 *  - The voucher binds seller, listing id, metadata URI hash, metadata hash, terms hash, nonce and
 *    expiry. The EIP-712 domain binds chain id and this contract address, so a signature is
 *    useless on another chain or another registry.
 *  - Exactly one passport may ever be minted for a given off-chain listing id.
 *  - Metadata URI, metadata hash and terms hash are immutable after mint.
 *  - Lifecycle status follows an explicit forward-only transition matrix.
 *  - Each passport may be permanently paired with at most one companion token, and only by an
 *    address holding PAIRING_ROLE (the YardTokenFactory).
 *
 * A passport is a record of a listing. It is not a claim on the physical item, and it carries no
 * financial rights of any kind.
 */
contract YardSaleAssetRegistry is ERC721, AccessControl, Pausable, ReentrancyGuard, EIP712 {
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant STATUS_ROLE = keccak256("STATUS_ROLE");
    bytes32 public constant PAIRING_ROLE = keccak256("PAIRING_ROLE");
    /// @notice Holder(s) of this role sign mint vouchers. It is NOT a mint permission by itself.
    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");

    bytes32 public constant MINT_VOUCHER_TYPEHASH =
        keccak256(
            "MintVoucher(address seller,bytes32 listingId,bytes32 metadataURIHash,bytes32 metadataHash,bytes32 termsHash,uint256 nonce,uint256 expiry)"
        );

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

    struct MintVoucher {
        address seller;
        bytes32 listingId;
        bytes32 metadataURIHash;
        bytes32 metadataHash;
        bytes32 termsHash;
        uint256 nonce;
        uint256 expiry;
    }

    uint256 private _nextTokenId = 1;

    mapping(uint256 => Passport) private _passports;
    mapping(uint256 => string) private _tokenURIs;
    mapping(bytes32 => uint256) public tokenIdForListing;
    /// @notice seller => nonce => consumed. A voucher can be redeemed at most once.
    mapping(address => mapping(uint256 => bool)) public voucherUsed;

    error ListingAlreadyMinted(bytes32 listingId);
    error UnknownPassport(uint256 tokenId);
    error EmptyListingId();
    error EmptyMetadataURI();
    error EmptyHash();
    error ZeroAddress();
    error NotAContract(address account);
    error CompanionTokenAlreadySet(uint256 tokenId, address existing);
    error StatusUnchanged(uint256 tokenId);
    error InvalidStatusTransition(uint256 tokenId, PassportStatus from, PassportStatus to);
    error VoucherExpired(uint256 expiry, uint256 nowTs);
    error VoucherAlreadyUsed(address seller, uint256 nonce);
    error VoucherSellerMismatch(address seller, address caller);
    error VoucherURIMismatch();
    error InvalidVoucherSignature(address recovered);

    event PassportMinted(
        uint256 indexed tokenId,
        address indexed owner,
        bytes32 indexed listingId,
        string metadataURI,
        bytes32 metadataHash,
        bytes32 termsHash
    );
    event MintVoucherRedeemed(address indexed seller, uint256 indexed nonce, uint256 indexed tokenId, address signer);
    event PassportStatusChanged(uint256 indexed tokenId, PassportStatus previousStatus, PassportStatus newStatus);
    event CompanionTokenPaired(uint256 indexed tokenId, address indexed companionToken);

    constructor(address admin)
        ERC721("YARD SALE Item Passport", "YARDP")
        EIP712("YARD SALE Item Passport", "1")
    {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(STATUS_ROLE, admin);
        _grantRole(SIGNER_ROLE, admin);
    }

    /// @notice EIP-712 digest for a voucher, exposed so the platform signer and clients agree byte-for-byte.
    function hashVoucher(MintVoucher calldata voucher) public view returns (bytes32) {
        return
            _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        MINT_VOUCHER_TYPEHASH,
                        voucher.seller,
                        voucher.listingId,
                        voucher.metadataURIHash,
                        voucher.metadataHash,
                        voucher.termsHash,
                        voucher.nonce,
                        voucher.expiry
                    )
                )
            );
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /**
     * @notice Mints the single Item Passport allowed for `voucher.listingId`.
     * @dev The caller MUST be `voucher.seller`. There is no other mint path.
     *      nonReentrant closes the ERC721 receiver callback re-entry path.
     */
    function mintPassport(MintVoucher calldata voucher, string calldata metadataURI, bytes calldata signature)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 tokenId)
    {
        if (voucher.seller == address(0)) revert ZeroAddress();
        if (voucher.seller != _msgSender()) revert VoucherSellerMismatch(voucher.seller, _msgSender());
        if (block.timestamp > voucher.expiry) revert VoucherExpired(voucher.expiry, block.timestamp);
        if (voucher.listingId == bytes32(0)) revert EmptyListingId();
        if (bytes(metadataURI).length == 0) revert EmptyMetadataURI();
        if (voucher.metadataHash == bytes32(0) || voucher.termsHash == bytes32(0)) revert EmptyHash();
        if (keccak256(bytes(metadataURI)) != voucher.metadataURIHash) revert VoucherURIMismatch();
        if (voucherUsed[voucher.seller][voucher.nonce]) revert VoucherAlreadyUsed(voucher.seller, voucher.nonce);
        if (tokenIdForListing[voucher.listingId] != 0) revert ListingAlreadyMinted(voucher.listingId);

        address signer = ECDSA.recover(hashVoucher(voucher), signature);
        if (!hasRole(SIGNER_ROLE, signer)) revert InvalidVoucherSignature(signer);

        voucherUsed[voucher.seller][voucher.nonce] = true;

        tokenId = _nextTokenId++;
        tokenIdForListing[voucher.listingId] = tokenId;
        _passports[tokenId] = Passport({
            listingId: voucher.listingId,
            metadataHash: voucher.metadataHash,
            termsHash: voucher.termsHash,
            companionToken: address(0),
            status: PassportStatus.Listed,
            mintedAt: uint64(block.timestamp)
        });
        _tokenURIs[tokenId] = metadataURI;
        _safeMint(voucher.seller, tokenId);

        emit MintVoucherRedeemed(voucher.seller, voucher.nonce, tokenId, signer);
        emit PassportMinted(
            tokenId,
            voucher.seller,
            voucher.listingId,
            metadataURI,
            voucher.metadataHash,
            voucher.termsHash
        );
    }

    /**
     * @notice Explicit forward-only lifecycle matrix.
     *
     *   Listed    -> Reserved | Withdrawn | Disputed
     *   Reserved  -> Collected | Withdrawn | Disputed
     *   Collected -> Disputed
     *   Disputed  -> Collected | Withdrawn
     *   Withdrawn -> (terminal)
     */
    function isValidTransition(PassportStatus from, PassportStatus to) public pure returns (bool) {
        if (from == to) return false;
        if (from == PassportStatus.Listed) {
            return to == PassportStatus.Reserved || to == PassportStatus.Withdrawn || to == PassportStatus.Disputed;
        }
        if (from == PassportStatus.Reserved) {
            return to == PassportStatus.Collected || to == PassportStatus.Withdrawn || to == PassportStatus.Disputed;
        }
        if (from == PassportStatus.Collected) {
            return to == PassportStatus.Disputed;
        }
        if (from == PassportStatus.Disputed) {
            return to == PassportStatus.Collected || to == PassportStatus.Withdrawn;
        }
        return false; // Withdrawn is terminal.
    }

    function setStatus(uint256 tokenId, PassportStatus newStatus) external onlyRole(STATUS_ROLE) whenNotPaused {
        _requireMinted(tokenId);
        PassportStatus previous = _passports[tokenId].status;
        if (previous == newStatus) revert StatusUnchanged(tokenId);
        if (!isValidTransition(previous, newStatus)) revert InvalidStatusTransition(tokenId, previous, newStatus);
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
