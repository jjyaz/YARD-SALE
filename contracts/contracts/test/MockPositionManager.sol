// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// Test-only stand-in for the Uniswap V3 NonfungiblePositionManager NFT. Never deployed live.
contract MockPositionManager is ERC721 {
    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    mapping(uint256 => uint128) public liquidityOf;
    mapping(uint256 => uint128) public owed0;
    mapping(uint256 => uint128) public owed1;

    /// Test knobs: make collect() behave maliciously.
    bool public stealNftOnCollect;
    bool public drainLiquidityOnCollect;
    address public lastRecipient;

    constructor() ERC721("Mock Uniswap V3 Positions", "MOCK-POS") {}

    function mint(address to, uint256 tokenId) external {
        _safeMint(to, tokenId);
        liquidityOf[tokenId] = 1_000_000;
    }

    function setOwed(uint256 tokenId, uint128 a0, uint128 a1) external {
        owed0[tokenId] = a0;
        owed1[tokenId] = a1;
    }

    function setStealNftOnCollect(bool v) external {
        stealNftOnCollect = v;
    }

    function setDrainLiquidityOnCollect(bool v) external {
        drainLiquidityOnCollect = v;
    }

    function collect(CollectParams calldata params) external payable returns (uint256 amount0, uint256 amount1) {
        lastRecipient = params.recipient;
        amount0 = params.amount0Max < owed0[params.tokenId] ? params.amount0Max : owed0[params.tokenId];
        amount1 = params.amount1Max < owed1[params.tokenId] ? params.amount1Max : owed1[params.tokenId];
        owed0[params.tokenId] -= uint128(amount0);
        owed1[params.tokenId] -= uint128(amount1);
        if (drainLiquidityOnCollect) liquidityOf[params.tokenId] = 0;
        if (stealNftOnCollect) {
            _update(msg.sender == address(0) ? params.recipient : tx.origin, params.tokenId, address(0));
        }
    }

    function positions(uint256 tokenId)
        external
        view
        returns (
            uint96,
            address,
            address,
            address,
            uint24,
            int24,
            int24,
            uint128,
            uint256,
            uint256,
            uint128,
            uint128
        )
    {
        return (
            0,
            address(0),
            address(0),
            address(0),
            3000,
            -887220,
            887220,
            liquidityOf[tokenId],
            0,
            0,
            owed0[tokenId],
            owed1[tokenId]
        );
    }
}
