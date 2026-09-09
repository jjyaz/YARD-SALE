// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Minimal slice of the Uniswap V3 NonfungiblePositionManager this locker relies on.
interface IUniswapV3Positions {
    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    function collect(CollectParams calldata params) external payable returns (uint256 amount0, uint256 amount1);

    function positions(uint256 tokenId)
        external
        view
        returns (
            uint96 nonce,
            address operator,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        );
}

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
 *
 * While a position is locked its original depositor — and nobody else — may collect trading fees.
 * Fees are always sent to the recorded depositor, and the call reverts if it would move the NFT or
 * reduce the position's liquidity.
 *
 * A position id can only ever be recorded once. Re-depositing a withdrawn position is rejected.
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
    mapping(uint256 => uint256) private _collected0;
    mapping(uint256 => uint256) private _collected1;

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
    error PositionAlreadyRecorded(uint256 positionId);
    error PositionNotHeld(uint256 positionId);
    error LiquidityDecreased(uint256 positionId, uint128 before_, uint128 afterLiquidity);
    error NothingToCollect(uint256 positionId);

    event PositionLocked(
        uint256 indexed positionId,
        address indexed depositor,
        uint64 lockedAt,
        uint64 unlockAt,
        bool permanent
    );
    event PositionWithdrawn(uint256 indexed positionId, address indexed depositor, uint256 withdrawnAt);
    event FeesCollected(uint256 indexed positionId, address indexed depositor, uint256 amount0, uint256 amount1);

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
     * @dev A position id that has ever been recorded — locked, or locked and later withdrawn —
     *      can never be deposited again, so no NFT can become stranded here without a live lock.
     */
    function onERC721Received(address, address from, uint256 positionId, bytes calldata data)
        external
        override
        returns (bytes4)
    {
        if (msg.sender != address(positionManager)) revert UnexpectedCollection(msg.sender);
        if (_locks[positionId].depositor != address(0)) {
            // The only legitimate re-entry is the transfer performed by lock() in this same call,
            // which records the lock immediately before moving the NFT.
            if (_locks[positionId].depositor != from || _locks[positionId].withdrawn) {
                revert PositionAlreadyRecorded(positionId);
            }
            if (positionManager.ownerOf(positionId) != address(this)) revert PositionAlreadyRecorded(positionId);
            return IERC721Receiver.onERC721Received.selector;
        }
        if (data.length != 64) revert BadLockData();
        (uint64 lockDuration, bool permanent) = abi.decode(data, (uint64, bool));
        _record(positionId, from, lockDuration, permanent);
        return IERC721Receiver.onERC721Received.selector;
    }

    function _record(uint256 positionId, address depositor, uint64 lockDuration, bool permanent) private {
        if (depositor == address(0)) revert ZeroAddress();
        if (_locks[positionId].depositor != address(0)) revert PositionAlreadyRecorded(positionId);
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

    /**
     * @notice Collects accrued trading fees for a locked position to its original depositor.
     * @dev Only the depositor may call. The recipient is forced to the recorded depositor, so fees
     *      can never be redirected. The call reverts if the position manager moved the NFT or
     *      reduced the position's liquidity, which makes a fee collection unable to unwind a lock.
     */
    function collectFees(uint256 positionId, uint128 amount0Max, uint128 amount1Max)
        external
        nonReentrant
        returns (uint256 amount0, uint256 amount1)
    {
        Lock storage l = _locks[positionId];
        if (l.depositor == address(0)) revert UnknownLock(positionId);
        if (l.withdrawn) revert AlreadyWithdrawn(positionId);
        if (l.depositor != msg.sender) revert NotDepositor(positionId, msg.sender);
        if (amount0Max == 0 && amount1Max == 0) revert NothingToCollect(positionId);
        if (positionManager.ownerOf(positionId) != address(this)) revert PositionNotHeld(positionId);

        (, , , , , , , uint128 liquidityBefore, , , , ) = IUniswapV3Positions(address(positionManager))
            .positions(positionId);

        (amount0, amount1) = IUniswapV3Positions(address(positionManager)).collect(
            IUniswapV3Positions.CollectParams({
                tokenId: positionId,
                recipient: l.depositor,
                amount0Max: amount0Max,
                amount1Max: amount1Max
            })
        );

        if (positionManager.ownerOf(positionId) != address(this)) revert PositionNotHeld(positionId);
        (, , , , , , , uint128 liquidityAfter, , , , ) = IUniswapV3Positions(address(positionManager))
            .positions(positionId);
        if (liquidityAfter < liquidityBefore) revert LiquidityDecreased(positionId, liquidityBefore, liquidityAfter);

        _collected0[positionId] += amount0;
        _collected1[positionId] += amount1;
        emit FeesCollected(positionId, l.depositor, amount0, amount1);
    }

    /// @notice Total fees this locker has collected for a position, per token.
    function collectedFees(uint256 positionId) external view returns (uint256 amount0, uint256 amount1) {
        return (_collected0[positionId], _collected1[positionId]);
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
