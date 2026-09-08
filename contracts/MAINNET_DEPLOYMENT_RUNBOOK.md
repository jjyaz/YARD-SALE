# YARD SALE — Robinhood Chain mainnet deployment runbook

Chain: **Robinhood Chain** · chainId **4663** · gas token **ETH**
Explorer: https://robinhoodchain.blockscout.com · API: https://robinhoodchain.blockscout.com/api/

This runbook is executed **outside Lovable**, from a clone/export of this repository, on a machine you
control. No private key, seed phrase, or RPC credential is ever entered into Lovable, the web app, or a
`VITE_*` variable.

## 0. What gets deployed (in this order)

| # | Step | Purpose |
|---|------|---------|
| 1 | `YardCompanionToken` | Fixed-supply ERC-20 implementation. Initializers disabled; every token is an ERC-1167 clone of it. |
| 2 | `YardSaleAssetRegistry(admin = deployer)` | ERC-721 Item Passports. One per listing, immutable URI/hashes, lifecycle, one companion token. |
| 3 | `YardTokenFactory(admin = deployer, registry, treasury, implementation)` | Clones tokens and pairs them with passports. |
| 4 | `registry.grantRole(PAIRING_ROLE, factory)` | Only the factory may pair tokens. |
| 5 | Grant `DEFAULT_ADMIN_ROLE`, `PAUSER_ROLE`, `STATUS_ROLE` (registry) and `DEFAULT_ADMIN_ROLE`, `PAUSER_ROLE` (factory) to `MAINNET_ADMIN_ADDRESS` | Permanent administration. |
| 6 | Deployer renounces `MINTER_ROLE`, `PAUSER_ROLE`, `STATUS_ROLE`, `DEFAULT_ADMIN_ROLE` on both contracts | Deployer key becomes powerless. Only runs after step 5 is verified on-chain. |

After step 6 the deployer account holds **no** role. `MINTER_ROLE` is held by nobody (sellers mint their
own passports; the admin can grant it later if a custodial minter is ever needed).

## 1. Prerequisites

- Node 20+ and npm.
- A **dedicated deployer account** funded with a little ETH on Robinhood Chain (the plan step prints the
  estimate; ~0.01 ETH is typically plenty on an Orbit L2).
- A **permanent administrator address** (`MAINNET_ADMIN_ADDRESS`). Strongly recommended: a multisig. It
  cannot be the zero address. It may differ from the deployer.
- Optional: a treasury address that receives the non-creator share of each token supply
  (`MAINNET_TREASURY_ADDRESS`, defaults to the admin).

## 2. Set up

```bash
cd contracts
npm install
cp .env.deploy.example .env
# edit .env: MAINNET_DEPLOYER_PRIVATE_KEY, RH_MAINNET_RPC_URL, MAINNET_ADMIN_ADDRESS (+ optional treasury)
```

`contracts/.env` is git-ignored. Never commit it, never copy its values anywhere else.

## 3. Validate before touching mainnet

```bash
npx hardhat compile
npx hardhat test                                   # 31 unit + deployment tests
npm run typecheck
MAINNET_FORK=true npx hardhat run scripts/simulate-mainnet-deploy.ts   # full rehearsal on a fork of 4663
```

The simulation forks the live chain at the current block, runs the exact production steps with a
throwaway Hardhat account, mints a passport, pairs a token, and prints PASS/FAIL for every check. Nothing
is broadcast and `deployments/4663.json` is not written.

## 4. Dry-run the real deployment (no broadcast)

```bash
npx hardhat run scripts/deploy-mainnet.ts --network robinhoodMainnet
```

Prints deployer, balance, chain id, admin, treasury, estimated cost, contract order, constructor args and
per-step gas. It refuses to continue if the chain id is not 4663, the admin is zero/invalid, the balance
is below the estimate, or `deployments/4663.json` already records a live deployment.

## 5. Deploy

```bash
CONFIRM_MAINNET_DEPLOY=YES npx hardhat run scripts/deploy-mainnet.ts --network robinhoodMainnet
```

Waits for every receipt, validates live state, and writes `deployments/4663.json` with addresses,
transaction hashes, block numbers, bytecode hashes, deployer, admin, treasury and timestamp. Commit that
file.

## 6. Verify on Blockscout

```bash
npx hardhat run scripts/verify-mainnet.ts --network robinhoodMainnet
```

## 7. Re-check any time (read-only, no key needed)

```bash
npx hardhat run scripts/check-mainnet-deployment.ts --network robinhoodMainnet
```

Exit code 0 = every check passed. 2 = something failed; do **not** enable mainnet in the app.

## 8. Update the app

Public variables (safe to expose; they are addresses, not secrets):

```
VITE_DEFAULT_CHAIN_ID=4663
VITE_ASSET_REGISTRY_ADDRESS=<registry address from deployments/4663.json>
VITE_TOKEN_FACTORY_ADDRESS=<factory address from deployments/4663.json>
VITE_ROBINHOOD_MAINNET_RPC_URL=<your mainnet RPC, or leave default>
VITE_ENABLE_MAINNET=false
```

Open `/status` in the app. It validates the addresses against live chain state: correct chain, valid
format, nonempty bytecode, expected interfaces, `factory.registry == registry`,
`registry.hasRole(PAIRING_ROLE, factory)`, `factory.implementation` has code and a locked initializer,
and that an administrator exists. Only when every check is green set:

```
VITE_ENABLE_MAINNET=true
```

The app refuses mainnet writes while any check fails, regardless of that flag.

## 9. Refresh ABIs in the app (if contracts changed)

```bash
node scripts/export-abis.js
```

## Safety notes

- The deploy script never prints or persists a private key. `deployments/4663.json` contains only public
  data.
- Deployment is one-shot by design; the script refuses to run twice against an existing live record.
- Passing tests, a passing fork rehearsal and green status checks are **not an audit**. Have the three
  contracts reviewed before inviting real users to mint on mainnet.
