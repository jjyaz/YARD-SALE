// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @title YardCompanionToken
 * @notice Fixed-supply ERC-20 companion token, cloneable via ERC-1167.
 *
 * Deliberately absent, forever:
 *  - no mint after initialization, no burn-and-remint, no rebase
 *  - no transfer tax, fee, or reflection
 *  - no blacklist, allowlist, or transfer pause
 *  - no owner, admin, or upgrade path
 *  - no yield, dividend, revenue share, redemption, or buy-back
 *  - no ownership of, or claim to, the physical item
 */
contract YardCompanionToken is Initializable, ERC20Upgradeable {
    string public constant RIGHTS_DISCLAIMER =
        "This token grants no ownership, redemption, revenue, dividend, yield, guaranteed value, or legal right to the physical item or its sale proceeds.";

    address public registry;
    uint256 public passportTokenId;
    address public creator;

    error ZeroAddress();
    error ZeroSupply();
    error InvalidAllocation();

    event CompanionTokenInitialized(
        address indexed registry,
        uint256 indexed passportTokenId,
        address indexed creator,
        uint256 totalSupply,
        uint256 creatorAllocation
    );

    constructor() {
        _disableInitializers();
    }

    /**
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
        if (creatorAllocation == 0 || creatorAllocation > supply) revert InvalidAllocation();

        __ERC20_init(name_, symbol_);

        registry = registry_;
        passportTokenId = passportTokenId_;
        creator = creator_;

        _mint(creator_, creatorAllocation);
        uint256 remainder = supply - creatorAllocation;
        if (remainder > 0) {
            _mint(treasury, remainder);
        }

        emit CompanionTokenInitialized(registry_, passportTokenId_, creator_, supply, creatorAllocation);
    }
}
