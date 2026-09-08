# YARD SALE roadmap

## In progress — Phase 3: mainnet-capable launchpad

- [ ] Contracts: factory takes an external token implementation, reentrancy guards, `factory` pointer on tokens, expanded tests (reentrancy, role transfer, pause, init, invariants)
- [ ] Hardhat: Robinhood mainnet (4663) network + Blockscout verify, TypeScript scripts, `.env.deploy.example`, `deployments/4663.json`, runbook
- [ ] Mainnet deploy tooling: dry-run plan, confirmation flag, ordered deploy, role handover + renounce, post-deploy validation, deployment record
- [ ] Mainnet-fork deployment simulation
- [ ] Database: passport/token intent + recovery columns, IPFS CID, liquidity positions table
- [ ] Runtime deployment validation (chain, format, bytecode, interfaces, registry↔factory, admin roles) gating mainnet writes
- [ ] Launchpad: sequential flow, connected-wallet ownership check, IPFS pinning, attestation + terms hash, review-before-sign, pending recovery, duplicate protection
- [ ] Uniswap v3 WETH liquidity step (mainnet only) with verified official addresses, exact approvals, sqrtPriceX96 math, pool verification
- [ ] Frontend unit tests (uniswap math, env validation, clone bytecode, terms hash)
- [ ] Browser e2e: fake wallet → sign in → launchpad → mint → token against a local chain
- [ ] Docs + completion report

## Ready

- Blockscout token-holder view on the token page (read-only)
- Passport lifecycle status changes (Reserved/Collected) driven by escrow in a later phase
- Escrow contract (`YardSaleEscrow`) and liquidity locker (`YardLiquidityLocker`) — separate phase after audit scope is agreed
