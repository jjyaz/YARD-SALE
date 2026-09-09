// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Test-only Gnosis-Safe-shaped multisig used to exercise administrator validation. Never deployed live.
contract MockSafe {
    uint256 private _threshold;
    address[] private _owners;

    constructor(address[] memory owners_, uint256 threshold_) {
        _owners = owners_;
        _threshold = threshold_;
    }

    function getThreshold() external view returns (uint256) {
        return _threshold;
    }

    function getOwners() external view returns (address[] memory) {
        return _owners;
    }
}

/// A contract that is emphatically not a multisig.
contract NotASafe {
    uint256 public value;
}
