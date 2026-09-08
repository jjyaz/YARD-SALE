// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @title YardCompanionToken
 * @notice Fixed-supply ERC-20 companion token, deployed as an ERC-1167 clone by YardTokenFactory.
 *
 * Deliberately absent, forever:
 *  - no mint after initialization, no burn-and-remint, no rebase
 *  - no transfer tax, fee, or reflection
 *  - no blacklist, allowlist, or transfer pause
 *  - no owner, admin, or upgrade path
 *  - no yield, dividend, revenue share, redemption, or buy-back
 *  - no ownership of, or claim to, the physical item
 *
 * The implementation contract disables its own initializer in the constructor, so the
 * implementation itself can never hold supply. Every clone can be initialized exactly once.
 */
contract YardCompanionToken is Initializable, ERC20Upgradeable {
    string public constant RIGHTS_DISCLAIMER =
        "This token grants no ownership, redemption, revenue, dividend, yield, guaranteed value, or legal right to the physical item or its sale proceeds.";

    /// @notice Hard ceiling so a typo can never create an absurd supply. 1e12 whole tokens at 18 decimals.
    uint256 public constant MAX_SUPPLY = 1_000_000_000_000 * 1e18;

    address public registry;
    address public factory;
    uint256 public passportTokenId;
    address public creator;

    error ZeroAddress();
    error ZeroSupply();
    error SupplyTooLarge(uint256 supply, uint256 max);
    error InvalidAllocation();

    event CompanionTokenInitialized(
        address indexed registry,
        uint256 indexed passportTokenId,
        address indexed creator,
        address factory,
        uint256 totalSupply,
        uint256 creatorAllocation
    );

    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Called exactly once by the factory, in the same transaction that creates the clone.
     * @param creatorAllocation portion of `supply` sent to `creator_`; the remainder goes to `treasury`.
     */
    function initialize(
        string calldata name_,
        string calldata symbol_,
        uint256 supply,
        uint256 creatorAllocation,
        address creator_,
        address treasury,
        address registry_,
        uint256 passportTokenId_
    ) external initializer {
        if (creator_ == address(0) || treasury == address(0) || registry_ == address(0)) revert ZeroAddress();
        if (supply == 0) revert ZeroSupply();
        if (supply > MAX_SUPPLY) revert SupplyTooLarge(supply, MAX_SUPPLY);
        if (creatorAllocation == 0 || creatorAllocation > supply) revert InvalidAllocation();

        __ERC20_init(name_, symbol_);

        registry = registry_;
        factory = msg.sender;
        passportTokenId = passportTokenId_;
        creator = creator_;

        _mint(creator_, creatorAllocation);
        uint256 remainder = supply - creatorAllocation;
        if (remainder > 0) {
            _mint(treasury, remainder);
        }

        emit CompanionTokenInitialized(registry_, passportTokenId_, creator_, msg.sender, supply, creatorAllocation);
    }
}
