// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import {YardCompanionToken} from "./YardCompanionToken.sol";

interface IYardSaleAssetRegistry {
    function companionTokenOf(uint256 tokenId) external view returns (address);
    function setCompanionToken(uint256 tokenId, address companionToken) external;
}

/**
 * @title YardTokenFactory
 * @notice Deploys fixed-supply companion tokens as ERC-1167 clones of a single audited
 *         implementation and permanently pairs exactly one token with exactly one Item Passport.
 *
 * Deployment order: YardCompanionToken (implementation) -> YardSaleAssetRegistry -> YardTokenFactory.
 * The registry admin must then grant PAIRING_ROLE to this factory.
 */
contract YardTokenFactory is AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    address public immutable implementation;
    IYardSaleAssetRegistry public immutable registry;
    address public treasury;

    mapping(uint256 => address) public tokenForPassport;
    mapping(address => uint256) public passportForToken;

    error ZeroAddress();
    error NotAContract(address account);
    error NotPassportOwner(uint256 passportTokenId, address caller);
    error PassportAlreadyTokenized(uint256 passportTokenId, address existing);
    error EmptyName();
    error EmptySymbol();
    error NameTooLong();
    error SymbolTooLong();

    event CompanionTokenCreated(
        uint256 indexed passportTokenId,
        address indexed token,
        address indexed creator,
        string name,
        string symbol,
        uint256 totalSupply,
        uint256 creatorAllocation
    );
    event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);

    constructor(address admin, address registry_, address treasury_, address implementation_) {
        if (admin == address(0) || registry_ == address(0) || treasury_ == address(0) || implementation_ == address(0)) {
            revert ZeroAddress();
        }
        if (registry_.code.length == 0) revert NotAContract(registry_);
        if (implementation_.code.length == 0) revert NotAContract(implementation_);

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        registry = IYardSaleAssetRegistry(registry_);
        treasury = treasury_;
        implementation = implementation_;
    }

    /**
     * @notice Creates the single companion token allowed for `passportTokenId`.
     * @dev Checks (ownership, uniqueness) -> effects (mappings) -> interactions (clone init, registry pairing).
     *      The clone address is deterministic per (registry, passport) so a second attempt can never
     *      collide with, or replace, the first.
     */
    function createCompanionToken(
        uint256 passportTokenId,
        string calldata name_,
        string calldata symbol_,
        uint256 totalSupply_,
        uint256 creatorAllocation
    ) external whenNotPaused nonReentrant returns (address token) {
        if (bytes(name_).length == 0) revert EmptyName();
        if (bytes(symbol_).length == 0) revert EmptySymbol();
        if (bytes(name_).length > 64) revert NameTooLong();
        if (bytes(symbol_).length > 16) revert SymbolTooLong();

        address owner = IERC721(address(registry)).ownerOf(passportTokenId);
        if (owner != _msgSender()) revert NotPassportOwner(passportTokenId, _msgSender());

        address existing = tokenForPassport[passportTokenId];
        if (existing == address(0)) {
            existing = registry.companionTokenOf(passportTokenId);
        }
        if (existing != address(0)) revert PassportAlreadyTokenized(passportTokenId, existing);

        token = Clones.cloneDeterministic(implementation, _salt(passportTokenId));

        // Effects before any external call into the new clone or the registry.
        tokenForPassport[passportTokenId] = token;
        passportForToken[token] = passportTokenId;

        YardCompanionToken(token).initialize(
            name_,
            symbol_,
            totalSupply_,
            creatorAllocation,
            _msgSender(),
            treasury,
            address(registry),
            passportTokenId
        );

        registry.setCompanionToken(passportTokenId, token);

        emit CompanionTokenCreated(
            passportTokenId,
            token,
            _msgSender(),
            name_,
            symbol_,
            totalSupply_,
            creatorAllocation
        );
    }

    function setTreasury(address newTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function predictTokenAddress(uint256 passportTokenId) external view returns (address) {
        return Clones.predictDeterministicAddress(implementation, _salt(passportTokenId));
    }

    /// @notice True only for tokens this factory created and paired.
    function isCompanionToken(address token) external view returns (bool) {
        uint256 passportTokenId = passportForToken[token];
        return passportTokenId != 0 && tokenForPassport[passportTokenId] == token;
    }

    function _salt(uint256 passportTokenId) private view returns (bytes32) {
        return keccak256(abi.encodePacked(address(registry), passportTokenId));
    }
}
