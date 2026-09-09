// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title YardLiquidityLocker
 * @notice Non-upgradeable time lock for Uniswap V3 position NFTs.
 *
 * Deliberately absent, forever:
 *  - no owner, admin, role, or pause
 *  - no emergency withdrawal, sweep, or migration
 *  - no way to shorten a lock or change a depositor
 *
 * A permanent lock (`permanent = true`) can never be withdrawn by anyone, including the depositor.
 * A timed lock must be at least MIN_LOCK_DURATION and can only be withdrawn by the original
 * depositor, strictly after `unlockAt`.
 */
contract YardLiquidityLocker is IERC721Receiver, ReentrancyGuard {
    uint256 public constant MIN_LOCK_DURATION = 180 days;

    /// @notice The single Uniswap V3 NonfungiblePositionManager this locker accepts.
    IERC721 public immutable positionManager;

    struct Lock {
        address depositor;
        uint64 lockedAt;
        uint64 unlockAt;
        bool permanent;
        bool withdrawn;
    }

    mapping(uint256 => Lock) private _locks;

    error ZeroAddress();
    error NotAContract(address account);
    error UnexpectedCollection(address caller);
    error LockDurationTooShort(uint256 duration, uint256 minimum);
    error UnknownLock(uint256 positionId);
    error AlreadyWithdrawn(uint256 positionId);
    error PermanentLock(uint256 positionId);
    error StillLocked(uint256 positionId, uint64 unlockAt, uint256 nowTs);
    error NotDepositor(uint256 positionId, address caller);
    error BadLockData();

    event PositionLocked(
        uint256 indexed positionId,
        address indexed depositor,
        uint64 lockedAt,
        uint64 unlockAt,
        bool permanent
    );
    event PositionWithdrawn(uint256 indexed positionId, address indexed depositor, uint256 withdrawnAt);

    constructor(address positionManager_) {
        if (positionManager_ == address(0)) revert ZeroAddress();
        if (positionManager_.code.length == 0) revert NotAContract(positionManager_);
        positionManager = IERC721(positionManager_);
    }

    /**
     * @notice Locks a position NFT already approved to this contract.
     * @param positionId Uniswap V3 position token id.
     * @param lockDuration Seconds from now until withdrawal is allowed. Ignored when `permanent`.
     * @param permanent When true the position can never be withdrawn.
     */
    function lock(uint256 positionId, uint64 lockDuration, bool permanent) external nonReentrant {
        _record(positionId, msg.sender, lockDuration, permanent);
        positionManager.safeTransferFrom(msg.sender, address(this), positionId);
        if (positionManager.ownerOf(positionId) != address(this)) revert BadLockData();
    }

    /**
     * @notice Direct-transfer entry point. `data` is abi.encode(uint64 lockDuration, bool permanent).
     */
    function onERC721Received(address, address from, uint256 positionId, bytes calldata data)
        external
        override
        returns (bytes4)
    {
        if (msg.sender != address(positionManager)) revert UnexpectedCollection(msg.sender);
        if (_locks[positionId].depositor == address(0)) {
            if (data.length != 64) revert BadLockData();
            (uint64 lockDuration, bool permanent) = abi.decode(data, (uint64, bool));
            _record(positionId, from, lockDuration, permanent);
        }
        return IERC721Receiver.onERC721Received.selector;
    }

    function _record(uint256 positionId, address depositor, uint64 lockDuration, bool permanent) private {
        if (depositor == address(0)) revert ZeroAddress();
        if (_locks[positionId].depositor != address(0)) revert BadLockData();
        if (!permanent && lockDuration < MIN_LOCK_DURATION) {
            revert LockDurationTooShort(lockDuration, MIN_LOCK_DURATION);
        }
        uint64 lockedAt = uint64(block.timestamp);
        uint64 unlockAt = permanent ? type(uint64).max : lockedAt + lockDuration;
        _locks[positionId] = Lock({
            depositor: depositor,
            lockedAt: lockedAt,
            unlockAt: unlockAt,
            permanent: permanent,
            withdrawn: false
        });
        emit PositionLocked(positionId, depositor, lockedAt, unlockAt, permanent);
    }

    /// @notice Returns the position NFT to its original depositor once the lock has expired.
    function withdraw(uint256 positionId) external nonReentrant {
        Lock storage l = _locks[positionId];
        if (l.depositor == address(0)) revert UnknownLock(positionId);
        if (l.withdrawn) revert AlreadyWithdrawn(positionId);
        if (l.permanent) revert PermanentLock(positionId);
        if (l.depositor != msg.sender) revert NotDepositor(positionId, msg.sender);
        if (block.timestamp < l.unlockAt) revert StillLocked(positionId, l.unlockAt, block.timestamp);

        l.withdrawn = true;
        emit PositionWithdrawn(positionId, l.depositor, block.timestamp);
        positionManager.safeTransferFrom(address(this), l.depositor, positionId);
    }

    function lockInfo(uint256 positionId) external view returns (Lock memory) {
        Lock memory l = _locks[positionId];
        if (l.depositor == address(0)) revert UnknownLock(positionId);
        return l;
    }

    /// @notice True when the locker currently holds the position and it has not been withdrawn.
    function isLocked(uint256 positionId) external view returns (bool) {
        Lock memory l = _locks[positionId];
        if (l.depositor == address(0) || l.withdrawn) return false;
        return positionManager.ownerOf(positionId) == address(this);
    }
}
