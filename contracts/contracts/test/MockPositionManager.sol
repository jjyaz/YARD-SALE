// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// Test-only stand-in for the Uniswap V3 NonfungiblePositionManager NFT. Never deployed live.
contract MockPositionManager is ERC721 {
    constructor() ERC721("Mock Uniswap V3 Positions", "MOCK-POS") {}

    function mint(address to, uint256 tokenId) external {
        _safeMint(to, tokenId);
    }
}
