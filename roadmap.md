# YARD SALE roadmap

## Done — Phase 3: mainnet-capable launchpad

- [x] Contracts: external token implementation, reentrancy guards, `factory` pointer on tokens, expanded tests (reentrancy, role transfer, pause, init, invariants) — 29/29 passing
- [x] Hardhat: Robinhood mainnet (4663) network + Blockscout verify, TypeScript scripts, `.env.deploy.example`, `deployments/4663.json`, `MAINNET_DEPLOYMENT_RUNBOOK.md`
- [x] Mainnet deploy tooling: dry-run plan, `CONFIRM_MAINNET_DEPLOY=YES` gate, ordered deploy, role handover + renounce, post-deploy validation, deployment record
- [x] Mainnet-fork deployment simulation (block 58052285)
- [x] Database: passport/token intent + recovery columns, IPFS CID, attestation, `liquidity_positions`, exact-string token supplies
- [x] Runtime deployment validation (chain, format, bytecode, interfaces, registry↔factory, admin roles) gating mainnet writes
- [x] Launchpad: sequential flow, connected-wallet ownership check, IPFS pinning, attestation + terms hash, review-before-sign, pending recovery, duplicate protection
- [x] Uniswap v3 WETH liquidity step (mainnet only) with verified official addresses, exact approvals, sqrtPriceX96 math, pool verification
- [x] Frontend unit tests — 53/53 passing
- [x] Browser e2e against a private local chain: wallet sign-in → publish → freeze → mint → token → pending recovery → token page offer + real transfer
- [x] Sell wizard stamps the live terms version; stale terms versions are rejected before freeze

## Done — Phase 4: mainnet security remediation

- [x] EIP-712 authorised mint vouchers (platform `SIGNER_ROLE`); self-mint front-running and voucher replay removed and tested
- [x] Forward-only passport status matrix
- [x] Hardened passport/token reconciliation: chain state, tokenURI, hashes, owner, tx target/sender/decoded calldata; token allocations read from the creation event, not balances
- [x] `YardLiquidityLocker` (180-day minimum or permanent, depositor-only withdrawal, no admin bypass) + tests
- [x] Locker wired into the launchpad: deposit, on-chain ownership verification, verified locker address / position id / unlock date
- [x] Stale liquidity quotes: existing pool price must be re-confirmed; the plan is voided if the live price moves beyond tolerance
- [x] Resumable mainnet deployment manifest, multisig-admin requirement, cost safety margin, role verification
- [x] Lint clean, typecheck clean, 64/64 frontend tests, 48/48 contract tests, production build

## Blocked on the user

- Deploy contracts (testnet and/or mainnet) from the exported repo, then set `VITE_ASSET_REGISTRY_ADDRESS` / `VITE_TOKEN_FACTORY_ADDRESS` / `VITE_LIQUIDITY_LOCKER_ADDRESS`, plus `PLATFORM_SIGNER_PRIVATE_KEY` (mint authorisations) and `PINATA_JWT` (IPFS pins)
- Independent security audit + legal review before `VITE_ENABLE_MAINNET=true`

## Ready

- Blockscout token-holder view on the token page (read-only)
- Passport lifecycle status changes (Reserved/Collected) driven by escrow in a later phase
- Escrow contract (`YardSaleEscrow`) — separate phase after audit scope is agreed
- Resolve the two pre-existing database linter notes (policy-less service-only table, one caller-executable security-definer function)
