# YARD SALE contracts

Solidity 0.8.24, OpenZeppelin 5.1, Hardhat. Nothing here is audited.

| Contract | Purpose |
| --- | --- |
| `YardSaleAssetRegistry` | ERC-721 Item Passports. One mint per listing id, immutable metadata/terms hashes, lifecycle status, one optional companion token. |
| `YardCompanionToken` | Fixed-supply ERC-20 clone. No mint, tax, rebase, blacklist, owner, yield, revenue or redemption rights. |
| `YardTokenFactory` | Deploys companion tokens as ERC-1167 clones and permanently pairs one token with one passport. |

## Install and test

```bash
cd contracts
npm install
npx hardhat test
```

## Deploy to Robinhood Chain testnet (chain id 46630)

1. Copy `.env.example` to `.env` and fill it in. **Only this workspace reads it — never the frontend.**

   ```
   DEPLOYER_PRIVATE_KEY=0x...        # throwaway testnet key, never a seed phrase
   ROBINHOOD_TESTNET_RPC_URL=https://rpc.testnet.chain.robinhood.com
   TREASURY_ADDRESS=0x...            # receives the non-creator share of each token supply
   ADMIN_ADDRESS=0x...               # optional, defaults to the deployer
   ```

2. Fund the deployer with testnet gas.

3. Deploy and verify:

   ```bash
   npx hardhat compile
   npx hardhat run scripts/deploy.js --network robinhoodTestnet
   npx hardhat run scripts/verify.js --network robinhoodTestnet
   node scripts/export-abis.js
   ```

The deploy script prints the two values the app needs:

```
VITE_ASSET_REGISTRY_ADDRESS=0x...
VITE_TOKEN_FACTORY_ADDRESS=0x...
```

It also grants `PAIRING_ROLE` on the registry to the factory. If `ADMIN_ADDRESS`
is a different account, that account must call
`registry.grantRole(PAIRING_ROLE, <factory>)` manually before any companion
token can be created.

The script refuses to run against any chain other than 46630.
