// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// ─────────────────────────────────────────────────────────────────────────────
//  MockUSDC.sol
//  6-decimal ERC-20 token for local Foundry testing and demo seeding.
//  NOT for production use.
// ─────────────────────────────────────────────────────────────────────────────

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}

    /// @notice Returns 6 (matching real Arc Testnet USDC).
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Public mint — anyone can mint for demo/testing purposes.
    /// @param to     Recipient address.
    /// @param amount Amount in 6-decimal units (e.g. 1_000_000 = 1.00 USDC).
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
