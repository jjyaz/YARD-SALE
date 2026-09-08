/**
 * Shared deployment core for YARD SALE contracts.
 *
 * Used by:
 *  - scripts/deploy-mainnet.ts            (real broadcast on Robinhood Chain, chainId 4663)
 *  - scripts/simulate-mainnet-deploy.ts   (same steps on a mainnet fork, no broadcast)
 *  - scripts/check-mainnet-deployment.ts  (post-deploy / pre-activation validation)
 *
 * Nothing in this module reads, prints, or persists a private key. Signers come from the
 * Hardhat network configuration only.
 */
import * as fs from "fs";
import * as path from "path";
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import type { Contract, ContractTransactionReceipt, Signer } from "ethers";

export const MAINNET_CHAIN_ID = 4663n;
export const ZERO = "0x0000000000000000000000000000000000000000";

export const DEPLOY_ORDER = [
  "YardCompanionToken (implementation)",
  "YardSaleAssetRegistry",
  "YardTokenFactory",
  "registry.grantRole(PAIRING_ROLE, factory)",
  "hand admin roles to MAINNET_ADMIN_ADDRESS",
  "renounce deployer roles",
] as const;

export type DeployedContract = {
  address: string;
  txHash: string;
  blockNumber: number;
  bytecodeHash: string;
  constructorArgs: unknown[];
};

export type RoleTx = {
  step: string;
  txHash: string;
  blockNumber: number;
};

export type DeploymentRecord = {
  schema: "yardsale-deployment/1";
  status: "not_deployed" | "deployed" | "simulated";
  network: string;
  chainId: number;
  deployer: string | null;
  admin: string | null;
  treasury: string | null;
  contracts: {
    implementation?: DeployedContract;
    registry?: DeployedContract;
    factory?: DeployedContract;
  };
  roleTransactions: RoleTx[];
  deployerRolesRenounced: boolean;
  compiler: { solidity: string; optimizerRuns: number; viaIR: boolean; evmVersion: string };
  deployedAt: string | null;
  notes: string[];
};

export type DeployInputs = {
  admin: string;
  treasury: string;
};

export type DeployOptions = {
  /** When true, the record is marked "simulated" and never written to deployments/4663.json. */
  simulation: boolean;
  log: (line: string) => void;
};

export function deploymentsPath(hre: HardhatRuntimeEnvironment, chainId: bigint | number): string {
  return path.join(hre.config.paths.root, "deployments", `${chainId}.json`);
}

export function emptyRecord(hre: HardhatRuntimeEnvironment, chainId: number, network: string): DeploymentRecord {
  const solc = hre.config.solidity.compilers[0];
  return {
    schema: "yardsale-deployment/1",
    status: "not_deployed",
    network,
    chainId,
    deployer: null,
    admin: null,
    treasury: null,
    contracts: {},
    roleTransactions: [],
    deployerRolesRenounced: false,
    compiler: {
      solidity: solc.version,
      optimizerRuns: Number(solc.settings?.optimizer?.runs ?? 200),
      viaIR: Boolean(solc.settings?.viaIR),
      evmVersion: String(solc.settings?.evmVersion ?? "default"),
    },
    deployedAt: null,
    notes: [],
  };
}

export function readRecord(hre: HardhatRuntimeEnvironment, chainId: bigint | number): DeploymentRecord | null {
  const file = deploymentsPath(hre, chainId);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as DeploymentRecord;
}

export function writeRecord(hre: HardhatRuntimeEnvironment, record: DeploymentRecord): string {
  const file = deploymentsPath(hre, record.chainId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

export function requireAddressEnv(name: string, fallback?: string): string {
  const { ethers } = require("ethers") as typeof import("ethers");
  const value = (process.env[name] || fallback || "").trim();
  if (!value) throw new Error(`${name} is required.`);
  if (!ethers.isAddress(value)) throw new Error(`${name} is not a valid address: ${value}`);
  if (value.toLowerCase() === ZERO) throw new Error(`${name} must be a nonzero address.`);
  return ethers.getAddress(value);
}

export async function requireChain(hre: HardhatRuntimeEnvironment, expected: bigint): Promise<bigint> {
  const net = await hre.ethers.provider.getNetwork();
  if (net.chainId !== expected) {
    throw new Error(
      `Refusing to continue: connected chainId is ${net.chainId}, expected ${expected}. ` +
        `Check --network and ${expected === MAINNET_CHAIN_ID ? "RH_MAINNET_RPC_URL" : "the RPC url"}.`,
    );
  }
  return net.chainId;
}

async function bytecodeHash(hre: HardhatRuntimeEnvironment, address: string): Promise<string> {
  const code = await hre.ethers.provider.getCode(address);
  if (code === "0x") throw new Error(`No bytecode at ${address}`);
  return hre.ethers.keccak256(code);
}

async function receiptOf(contract: Contract): Promise<ContractTransactionReceipt> {
  const tx = contract.deploymentTransaction();
  if (!tx) throw new Error("Missing deployment transaction.");
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new Error(`Deployment transaction ${tx.hash} failed.`);
  return receipt;
}

/** Estimates the full deployment cost in wei (deploys + role transactions). */
export async function estimateDeploymentCost(
  hre: HardhatRuntimeEnvironment,
  deployer: Signer,
  inputs: DeployInputs,
): Promise<{ gas: bigint; gasPrice: bigint; wei: bigint; perStep: Array<{ step: string; gas: bigint }> }> {
  const { ethers } = hre;
  const from = await deployer.getAddress();
  const perStep: Array<{ step: string; gas: bigint }> = [];

  const Impl = await ethers.getContractFactory("YardCompanionToken", deployer);
  const implTx = await Impl.getDeployTransaction();
  const implGas = await ethers.provider.estimateGas({ ...implTx, from });
  perStep.push({ step: DEPLOY_ORDER[0], gas: implGas });

  const Registry = await ethers.getContractFactory("YardSaleAssetRegistry", deployer);
  const registryTx = await Registry.getDeployTransaction(from);
  const registryGas = await ethers.provider.estimateGas({ ...registryTx, from });
  perStep.push({ step: DEPLOY_ORDER[1], gas: registryGas });

  // The factory constructor checks that registry/implementation have code, so its gas can only be
  // estimated once they exist. Use a conservative constant derived from local runs.
  const factoryGas = 1_900_000n;
  perStep.push({ step: `${DEPLOY_ORDER[2]} (conservative estimate)`, gas: factoryGas });

  const roleGas = 60_000n * 12n;
  perStep.push({ step: "role grants + renounces (12 tx, conservative)", gas: roleGas });

  const gas = perStep.reduce((sum, s) => sum + s.gas, 0n);
  const fee = await ethers.provider.getFeeData();
  const gasPrice = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
  void inputs;
  return { gas, gasPrice, wei: gas * gasPrice, perStep };
}

/**
 * Runs the full ordered deployment with the given signer. Every step waits for its receipt.
 * Returns a record that the caller decides whether to persist.
 */
export async function runDeployment(
  hre: HardhatRuntimeEnvironment,
  deployer: Signer,
  inputs: DeployInputs,
  options: DeployOptions,
): Promise<DeploymentRecord> {
  const { ethers } = hre;
  const log = options.log;
  const deployerAddress = await deployer.getAddress();
  const net = await ethers.provider.getNetwork();
  const record = emptyRecord(hre, Number(net.chainId), hre.network.name);
  record.deployer = deployerAddress;
  record.admin = inputs.admin;
  record.treasury = inputs.treasury;

  // 1. Token implementation (initializers disabled in constructor).
  log(`[1/6] Deploying ${DEPLOY_ORDER[0]} ...`);
  const Impl = await ethers.getContractFactory("YardCompanionToken", deployer);
  const impl = await Impl.deploy();
  const implReceipt = await receiptOf(impl as unknown as Contract);
  const implAddress = await impl.getAddress();
  record.contracts.implementation = {
    address: implAddress,
    txHash: implReceipt.hash,
    blockNumber: implReceipt.blockNumber,
    bytecodeHash: await bytecodeHash(hre, implAddress),
    constructorArgs: [],
  };
  log(`      ${implAddress} (tx ${implReceipt.hash})`);

  // 2. Registry, deployer as temporary admin so it can wire the factory.
  log(`[2/6] Deploying ${DEPLOY_ORDER[1]} ...`);
  const Registry = await ethers.getContractFactory("YardSaleAssetRegistry", deployer);
  const registry = await Registry.deploy(deployerAddress);
  const registryReceipt = await receiptOf(registry as unknown as Contract);
  const registryAddress = await registry.getAddress();
  record.contracts.registry = {
    address: registryAddress,
    txHash: registryReceipt.hash,
    blockNumber: registryReceipt.blockNumber,
    bytecodeHash: await bytecodeHash(hre, registryAddress),
    constructorArgs: [deployerAddress],
  };
  log(`      ${registryAddress} (tx ${registryReceipt.hash})`);

  // 3. Factory pointing at registry + implementation.
  log(`[3/6] Deploying ${DEPLOY_ORDER[2]} ...`);
  const Factory = await ethers.getContractFactory("YardTokenFactory", deployer);
  const factory = await Factory.deploy(deployerAddress, registryAddress, inputs.treasury, implAddress);
  const factoryReceipt = await receiptOf(factory as unknown as Contract);
  const factoryAddress = await factory.getAddress();
  record.contracts.factory = {
    address: factoryAddress,
    txHash: factoryReceipt.hash,
    blockNumber: factoryReceipt.blockNumber,
    bytecodeHash: await bytecodeHash(hre, factoryAddress),
    constructorArgs: [deployerAddress, registryAddress, inputs.treasury, implAddress],
  };
  log(`      ${factoryAddress} (tx ${factoryReceipt.hash})`);

  const roleTx = async (step: string, send: () => Promise<{ wait: () => Promise<any> }>) => {
    const tx = await send();
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) throw new Error(`${step} failed (tx ${receipt?.hash ?? "?"})`);
    record.roleTransactions.push({ step, txHash: receipt.hash, blockNumber: receipt.blockNumber });
    log(`      ${step} (tx ${receipt.hash})`);
  };

  const DEFAULT_ADMIN_ROLE = await registry.DEFAULT_ADMIN_ROLE();
  const MINTER_ROLE = await registry.MINTER_ROLE();
  const PAUSER_ROLE = await registry.PAUSER_ROLE();
  const STATUS_ROLE = await registry.STATUS_ROLE();
  const PAIRING_ROLE = await registry.PAIRING_ROLE();
  const FACTORY_PAUSER_ROLE = await factory.PAUSER_ROLE();

  // 4. Authorize the factory to pair tokens.
  log(`[4/6] ${DEPLOY_ORDER[3]} ...`);
  await roleTx("registry.grantRole(PAIRING_ROLE, factory)", () => registry.grantRole(PAIRING_ROLE, factoryAddress));
  if (!(await registry.hasRole(PAIRING_ROLE, factoryAddress))) throw new Error("Factory did not receive PAIRING_ROLE.");

  // 5. Hand admin roles to the permanent administrator.
  const sameAdmin = inputs.admin.toLowerCase() === deployerAddress.toLowerCase();
  log(`[5/6] ${DEPLOY_ORDER[4]} ...`);
  if (sameAdmin) {
    log("      Deployer is the configured admin; no role transfer needed.");
    record.notes.push("Deployer address equals MAINNET_ADMIN_ADDRESS; roles were not transferred or renounced.");
  } else {
    await roleTx("registry.grantRole(DEFAULT_ADMIN_ROLE, admin)", () =>
      registry.grantRole(DEFAULT_ADMIN_ROLE, inputs.admin),
    );
    await roleTx("registry.grantRole(PAUSER_ROLE, admin)", () => registry.grantRole(PAUSER_ROLE, inputs.admin));
    await roleTx("registry.grantRole(STATUS_ROLE, admin)", () => registry.grantRole(STATUS_ROLE, inputs.admin));
    await roleTx("factory.grantRole(DEFAULT_ADMIN_ROLE, admin)", () =>
      factory.grantRole(DEFAULT_ADMIN_ROLE, inputs.admin),
    );
    await roleTx("factory.grantRole(PAUSER_ROLE, admin)", () => factory.grantRole(FACTORY_PAUSER_ROLE, inputs.admin));

    // Confirm the administrator actually holds every role before the deployer lets go.
    const adminHas = await Promise.all([
      registry.hasRole(DEFAULT_ADMIN_ROLE, inputs.admin),
      registry.hasRole(PAUSER_ROLE, inputs.admin),
      registry.hasRole(STATUS_ROLE, inputs.admin),
      factory.hasRole(DEFAULT_ADMIN_ROLE, inputs.admin),
      factory.hasRole(FACTORY_PAUSER_ROLE, inputs.admin),
    ]);
    if (adminHas.some((ok) => !ok)) {
      throw new Error("Administrator is missing a role after the grants; deployer roles were NOT renounced.");
    }

    // 6. Renounce every deployer privilege. Order matters: DEFAULT_ADMIN last.
    log(`[6/6] ${DEPLOY_ORDER[5]} ...`);
    await roleTx("registry.renounceRole(MINTER_ROLE, deployer)", () =>
      registry.renounceRole(MINTER_ROLE, deployerAddress),
    );
    await roleTx("registry.renounceRole(PAUSER_ROLE, deployer)", () =>
      registry.renounceRole(PAUSER_ROLE, deployerAddress),
    );
    await roleTx("registry.renounceRole(STATUS_ROLE, deployer)", () =>
      registry.renounceRole(STATUS_ROLE, deployerAddress),
    );
    await roleTx("factory.renounceRole(PAUSER_ROLE, deployer)", () =>
      factory.renounceRole(FACTORY_PAUSER_ROLE, deployerAddress),
    );
    await roleTx("factory.renounceRole(DEFAULT_ADMIN_ROLE, deployer)", () =>
      factory.renounceRole(DEFAULT_ADMIN_ROLE, deployerAddress),
    );
    await roleTx("registry.renounceRole(DEFAULT_ADMIN_ROLE, deployer)", () =>
      registry.renounceRole(DEFAULT_ADMIN_ROLE, deployerAddress),
    );
    record.deployerRolesRenounced = true;
  }

  record.status = options.simulation ? "simulated" : "deployed";
  record.deployedAt = new Date().toISOString();
  return record;
}

export type CheckResult = { check: string; ok: boolean; detail: string };

/**
 * Validates a deployment record against live chain state. Pure reads; safe to run anywhere.
 */
export async function validateDeployment(
  hre: HardhatRuntimeEnvironment,
  record: DeploymentRecord,
): Promise<CheckResult[]> {
  const { ethers } = hre;
  const results: CheckResult[] = [];
  const push = (check: string, ok: boolean, detail: string) => results.push({ check, ok, detail });

  const net = await ethers.provider.getNetwork();
  push("chain id", Number(net.chainId) === record.chainId, `connected ${net.chainId}, record ${record.chainId}`);

  const { implementation, registry: reg, factory: fac } = record.contracts;
  if (!implementation || !reg || !fac) {
    push("record complete", false, "deployment record is missing one or more contract entries");
    return results;
  }

  for (const [label, entry] of [
    ["implementation", implementation],
    ["registry", reg],
    ["factory", fac],
  ] as const) {
    const code = await ethers.provider.getCode(entry.address);
    const nonEmpty = code !== "0x";
    push(`${label} bytecode present`, nonEmpty, entry.address);
    if (nonEmpty) {
      const hash = ethers.keccak256(code);
      push(`${label} bytecode hash matches record`, hash === entry.bytecodeHash, hash);
    }
  }

  const registry = await ethers.getContractAt("YardSaleAssetRegistry", reg.address);
  const factory = await ethers.getContractAt("YardTokenFactory", fac.address);
  const impl = await ethers.getContractAt("YardCompanionToken", implementation.address);

  const factoryRegistry = await factory.registry();
  push("factory.registry == registry", factoryRegistry.toLowerCase() === reg.address.toLowerCase(), factoryRegistry);
  const factoryImpl = await factory.implementation();
  push(
    "factory.implementation == implementation",
    factoryImpl.toLowerCase() === implementation.address.toLowerCase(),
    factoryImpl,
  );
  const treasury = await factory.treasury();
  push("factory.treasury nonzero", treasury.toLowerCase() !== ZERO, treasury);

  const PAIRING_ROLE = await registry.PAIRING_ROLE();
  push(
    "registry grants PAIRING_ROLE to factory",
    await registry.hasRole(PAIRING_ROLE, fac.address),
    fac.address,
  );

  const DEFAULT_ADMIN_ROLE = await registry.DEFAULT_ADMIN_ROLE();
  if (record.admin) {
    push("admin holds registry DEFAULT_ADMIN_ROLE", await registry.hasRole(DEFAULT_ADMIN_ROLE, record.admin), record.admin);
    push("admin holds factory DEFAULT_ADMIN_ROLE", await factory.hasRole(DEFAULT_ADMIN_ROLE, record.admin), record.admin);
  }
  if (record.deployer && record.deployerRolesRenounced) {
    const deployerStill =
      (await registry.hasRole(DEFAULT_ADMIN_ROLE, record.deployer)) ||
      (await factory.hasRole(DEFAULT_ADMIN_ROLE, record.deployer));
    push("deployer holds no admin role", !deployerStill, record.deployer);
  }

  push("registry not paused", !(await registry.paused()), "");
  push("factory not paused", !(await factory.paused()), "");

  const name = await registry.name();
  push("registry ERC-721 name", name === "YARD SALE Item Passport", name);
  const erc721 = await registry.supportsInterface("0x80ac58cd");
  push("registry supports ERC-721", erc721, "0x80ac58cd");

  // Implementation must be locked: initialize() has to revert.
  let implLocked = false;
  try {
    await impl.initialize.staticCall("x", "X", 1n, 1n, record.deployer ?? fac.address, fac.address, reg.address, 1n);
  } catch {
    implLocked = true;
  }
  push("implementation initializer disabled", implLocked, implementation.address);

  const implSupply = await impl.totalSupply();
  push("implementation holds no supply", implSupply === 0n, implSupply.toString());

  return results;
}

export function printChecks(results: CheckResult[], log: (line: string) => void): boolean {
  let allOk = true;
  for (const r of results) {
    allOk = allOk && r.ok;
    log(`${r.ok ? "PASS" : "FAIL"}  ${r.check}${r.detail ? `  (${r.detail})` : ""}`);
  }
  return allOk;
}
