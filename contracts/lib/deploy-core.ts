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
 *
 * The deployment is RESUMABLE: every contract address, transaction hash and role transaction is
 * persisted through `options.persist` the moment its receipt is confirmed, so a partial failure can
 * never leave an untracked contract on chain. Re-running the script reuses whatever the manifest
 * already records and continues from the first missing step.
 */
import * as fs from "fs";
import * as path from "path";
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import type { Contract, ContractTransactionReceipt, Signer } from "ethers";

export const MAINNET_CHAIN_ID = 4663n;
export const ZERO = "0x0000000000000000000000000000000000000000";
/** Multiplier applied to the raw gas estimate before comparing against the deployer balance. */
export const COST_SAFETY_MARGIN = 150n; // percent

export const DEPLOY_ORDER = [
  "YardCompanionToken (implementation)",
  "YardSaleAssetRegistry",
  "YardTokenFactory",
  "YardLiquidityLocker",
  "registry.grantRole(PAIRING_ROLE, factory)",
  "registry.grantRole(SIGNER_ROLE, platform signer)",
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
  schema: "yardsale-deployment/2";
  status: "not_deployed" | "in_progress" | "deployed" | "simulated";
  network: string;
  chainId: number;
  deployer: string | null;
  admin: string | null;
  treasury: string | null;
  platformSigner: string | null;
  positionManager: string | null;
  contracts: {
    implementation?: DeployedContract;
    registry?: DeployedContract;
    factory?: DeployedContract;
    locker?: DeployedContract;
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
  /** Address that will sign EIP-712 mint vouchers. Never a key — only the public address. */
  platformSigner: string;
  /** Uniswap V3 NonfungiblePositionManager the locker will accept. Optional: skips the locker. */
  positionManager?: string;
};

export type DeployOptions = {
  /** When true, the record is marked "simulated" and never written to deployments/<chain>.json. */
  simulation: boolean;
  log: (line: string) => void;
  /** Called after every confirmed step so progress survives a crash. */
  persist?: (record: DeploymentRecord) => void;
  /** Manifest from a previous partial run to resume from. */
  resumeFrom?: DeploymentRecord | null;
};

export function deploymentsPath(hre: HardhatRuntimeEnvironment, chainId: bigint | number): string {
  return path.join(hre.config.paths.root, "deployments", `${chainId}.json`);
}

export function emptyRecord(hre: HardhatRuntimeEnvironment, chainId: number, network: string): DeploymentRecord {
  const solc = hre.config.solidity.compilers[0];
  return {
    schema: "yardsale-deployment/2",
    status: "not_deployed",
    network,
    chainId,
    deployer: null,
    admin: null,
    treasury: null,
    platformSigner: null,
    positionManager: null,
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

/** The permanent administrator must be a contract (multisig), and must not be the deployer. */
export async function requireMultisigAdmin(
  hre: HardhatRuntimeEnvironment,
  admin: string,
  deployer: string,
): Promise<void> {
  if (admin.toLowerCase() === deployer.toLowerCase()) {
    throw new Error(
      "MAINNET_ADMIN_ADDRESS must not equal the deployer. The deployer key must end the deployment powerless.",
    );
  }
  const code = await hre.ethers.provider.getCode(admin);
  if (code === "0x") {
    throw new Error(
      `MAINNET_ADMIN_ADDRESS ${admin} has no bytecode. A multisig (contract) administrator is required; ` +
        "a single EOA is not an acceptable permanent admin for mainnet.",
    );
  }
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

/** Estimates the full deployment cost in wei (deploys + role transactions), with a safety margin. */
export async function estimateDeploymentCost(
  hre: HardhatRuntimeEnvironment,
  deployer: Signer,
  inputs: DeployInputs,
): Promise<{
  gas: bigint;
  gasPrice: bigint;
  wei: bigint;
  weiWithMargin: bigint;
  perStep: Array<{ step: string; gas: bigint }>;
}> {
  const { ethers } = hre;
  const from = await deployer.getAddress();
  const perStep: Array<{ step: string; gas: bigint }> = [];

  const Impl = await ethers.getContractFactory("YardCompanionToken", deployer);
  const implTx = await Impl.getDeployTransaction();
  perStep.push({ step: DEPLOY_ORDER[0], gas: await ethers.provider.estimateGas({ ...implTx, from }) });

  const Registry = await ethers.getContractFactory("YardSaleAssetRegistry", deployer);
  const registryTx = await Registry.getDeployTransaction(from);
  perStep.push({ step: DEPLOY_ORDER[1], gas: await ethers.provider.estimateGas({ ...registryTx, from }) });

  // The factory / locker constructors check that their dependencies have code, so their gas can only
  // be estimated once those exist. Conservative constants derived from local runs.
  perStep.push({ step: `${DEPLOY_ORDER[2]} (conservative estimate)`, gas: 1_900_000n });
  if (inputs.positionManager) {
    perStep.push({ step: `${DEPLOY_ORDER[3]} (conservative estimate)`, gas: 900_000n });
  }
  perStep.push({ step: "role grants + renounces (16 tx, conservative)", gas: 60_000n * 16n });

  const gas = perStep.reduce((sum, s) => sum + s.gas, 0n);
  const fee = await ethers.provider.getFeeData();
  const gasPrice = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
  const wei = gas * gasPrice;
  return { gas, gasPrice, wei, weiWithMargin: (wei * COST_SAFETY_MARGIN) / 100n, perStep };
}

/**
 * Runs the full ordered deployment with the given signer. Every step waits for its receipt and is
 * persisted immediately. Safe to re-run against a partial manifest.
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

  const resume = options.resumeFrom;
  const record: DeploymentRecord =
    resume && resume.schema === "yardsale-deployment/2" && resume.status === "in_progress"
      ? resume
      : emptyRecord(hre, Number(net.chainId), hre.network.name);
  record.status = "in_progress";
  record.deployer = deployerAddress;
  record.admin = inputs.admin;
  record.treasury = inputs.treasury;
  record.platformSigner = inputs.platformSigner;
  record.positionManager = inputs.positionManager ?? null;

  const save = () => options.persist?.(record);
  save();

  const doneSteps = new Set(record.roleTransactions.map((r) => r.step));
  const roleTx = async (step: string, send: () => Promise<{ wait: () => Promise<any> }>) => {
    if (doneSteps.has(step)) {
      log(`      ${step} (already recorded, skipped)`);
      return;
    }
    const tx = await send();
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) throw new Error(`${step} failed (tx ${receipt?.hash ?? "?"})`);
    record.roleTransactions.push({ step, txHash: receipt.hash, blockNumber: receipt.blockNumber });
    save();
    log(`      ${step} (tx ${receipt.hash})`);
  };

  const deployStep = async (
    key: keyof DeploymentRecord["contracts"],
    label: string,
    factoryName: string,
    args: unknown[],
  ): Promise<string> => {
    const existing = record.contracts[key];
    if (existing) {
      const code = await ethers.provider.getCode(existing.address);
      if (code !== "0x") {
        log(`      ${label} already deployed at ${existing.address} (resumed)`);
        return existing.address;
      }
      record.notes.push(`Manifest recorded ${label} at ${existing.address} but there is no bytecode there; redeploying.`);
    }
    log(`Deploying ${label} ...`);
    const CF = await ethers.getContractFactory(factoryName, deployer);
    const c = await CF.deploy(...(args as never[]));
    const receipt = await receiptOf(c as unknown as Contract);
    const address = await c.getAddress();
    record.contracts[key] = {
      address,
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      bytecodeHash: await bytecodeHash(hre, address),
      constructorArgs: args,
    };
    save();
    log(`      ${address} (tx ${receipt.hash})`);
    return address;
  };

  const implAddress = await deployStep("implementation", DEPLOY_ORDER[0], "YardCompanionToken", []);
  const registryAddress = await deployStep("registry", DEPLOY_ORDER[1], "YardSaleAssetRegistry", [deployerAddress]);
  const factoryAddress = await deployStep("factory", DEPLOY_ORDER[2], "YardTokenFactory", [
    deployerAddress,
    registryAddress,
    inputs.treasury,
    implAddress,
  ]);
  if (inputs.positionManager) {
    await deployStep("locker", DEPLOY_ORDER[3], "YardLiquidityLocker", [inputs.positionManager]);
  }

  const registry = await ethers.getContractAt("YardSaleAssetRegistry", registryAddress, deployer);
  const factory = await ethers.getContractAt("YardTokenFactory", factoryAddress, deployer);

  const DEFAULT_ADMIN_ROLE = await registry.DEFAULT_ADMIN_ROLE();
  const PAUSER_ROLE = await registry.PAUSER_ROLE();
  const STATUS_ROLE = await registry.STATUS_ROLE();
  const PAIRING_ROLE = await registry.PAIRING_ROLE();
  const SIGNER_ROLE = await registry.SIGNER_ROLE();
  const FACTORY_PAUSER_ROLE = await factory.PAUSER_ROLE();

  log(`${DEPLOY_ORDER[4]} ...`);
  if (!(await registry.hasRole(PAIRING_ROLE, factoryAddress))) {
    await roleTx("registry.grantRole(PAIRING_ROLE, factory)", () => registry.grantRole(PAIRING_ROLE, factoryAddress));
  }
  if (!(await registry.hasRole(PAIRING_ROLE, factoryAddress))) throw new Error("Factory did not receive PAIRING_ROLE.");

  log(`${DEPLOY_ORDER[5]} ...`);
  if (!(await registry.hasRole(SIGNER_ROLE, inputs.platformSigner))) {
    await roleTx("registry.grantRole(SIGNER_ROLE, platformSigner)", () =>
      registry.grantRole(SIGNER_ROLE, inputs.platformSigner),
    );
  }
  if (!(await registry.hasRole(SIGNER_ROLE, inputs.platformSigner))) {
    throw new Error("Platform signer did not receive SIGNER_ROLE.");
  }

  const sameAdmin = inputs.admin.toLowerCase() === deployerAddress.toLowerCase();
  if (sameAdmin) {
    throw new Error("Refusing to finish: the administrator address equals the deployer address.");
  }

  log(`${DEPLOY_ORDER[6]} ...`);
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

  log(`${DEPLOY_ORDER[7]} ...`);
  await roleTx("registry.renounceRole(SIGNER_ROLE, deployer)", () =>
    registry.renounceRole(SIGNER_ROLE, deployerAddress),
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

  record.status = options.simulation ? "simulated" : "deployed";
  record.deployedAt = new Date().toISOString();
  save();
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

  const { implementation, registry: reg, factory: fac, locker: lock } = record.contracts;
  if (!implementation || !reg || !fac) {
    push("record complete", false, "deployment record is missing one or more contract entries");
    return results;
  }

  const entries: Array<[string, DeployedContract]> = [
    ["implementation", implementation],
    ["registry", reg],
    ["factory", fac],
  ];
  if (lock) entries.push(["locker", lock]);

  for (const [label, entry] of entries) {
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
  if (record.treasury) {
    push("factory.treasury matches record", treasury.toLowerCase() === record.treasury.toLowerCase(), treasury);
    push(
      "treasury is not the deployer",
      !record.deployer || treasury.toLowerCase() !== record.deployer.toLowerCase(),
      treasury,
    );
  }

  const PAIRING_ROLE = await registry.PAIRING_ROLE();
  const SIGNER_ROLE = await registry.SIGNER_ROLE();
  const PAUSER_ROLE = await registry.PAUSER_ROLE();
  const STATUS_ROLE = await registry.STATUS_ROLE();
  const DEFAULT_ADMIN_ROLE = await registry.DEFAULT_ADMIN_ROLE();
  const FACTORY_PAUSER_ROLE = await factory.PAUSER_ROLE();

  push("registry grants PAIRING_ROLE to factory", await registry.hasRole(PAIRING_ROLE, fac.address), fac.address);

  if (record.platformSigner) {
    push(
      "platform signer holds SIGNER_ROLE",
      await registry.hasRole(SIGNER_ROLE, record.platformSigner),
      record.platformSigner,
    );
  }

  if (record.admin) {
    push("admin holds registry DEFAULT_ADMIN_ROLE", await registry.hasRole(DEFAULT_ADMIN_ROLE, record.admin), record.admin);
    push("admin holds registry PAUSER_ROLE", await registry.hasRole(PAUSER_ROLE, record.admin), record.admin);
    push("admin holds registry STATUS_ROLE", await registry.hasRole(STATUS_ROLE, record.admin), record.admin);
    push("admin holds factory DEFAULT_ADMIN_ROLE", await factory.hasRole(DEFAULT_ADMIN_ROLE, record.admin), record.admin);
    push("admin holds factory PAUSER_ROLE", await factory.hasRole(FACTORY_PAUSER_ROLE, record.admin), record.admin);
    push(
      "admin is not the deployer",
      !record.deployer || record.admin.toLowerCase() !== record.deployer.toLowerCase(),
      record.admin,
    );
  }

  if (record.deployer && record.deployerRolesRenounced) {
    const held = await Promise.all([
      registry.hasRole(DEFAULT_ADMIN_ROLE, record.deployer),
      registry.hasRole(PAUSER_ROLE, record.deployer),
      registry.hasRole(STATUS_ROLE, record.deployer),
      registry.hasRole(PAIRING_ROLE, record.deployer),
      registry.hasRole(SIGNER_ROLE, record.deployer),
      factory.hasRole(DEFAULT_ADMIN_ROLE, record.deployer),
      factory.hasRole(FACTORY_PAUSER_ROLE, record.deployer),
    ]);
    push("deployer holds no admin/pauser/status/pairing/signer role", !held.some(Boolean), record.deployer);
  }

  push("registry not paused", !(await registry.paused()), "");
  push("factory not paused", !(await factory.paused()), "");

  const name = await registry.name();
  push("registry ERC-721 name", name === "YARD SALE Item Passport", name);
  push("registry supports ERC-721", await registry.supportsInterface("0x80ac58cd"), "0x80ac58cd");
  const separator = await registry.domainSeparator();
  push("registry EIP-712 domain separator set", separator !== ethers.ZeroHash, separator);

  if (lock) {
    const locker = await ethers.getContractAt("YardLiquidityLocker", lock.address);
    const pm = await locker.positionManager();
    push(
      "locker.positionManager matches record",
      !record.positionManager || pm.toLowerCase() === record.positionManager.toLowerCase(),
      pm,
    );
    const pmCode = await ethers.provider.getCode(pm);
    push("locker position manager has bytecode", pmCode !== "0x", pm);
    push("locker minimum lock is 180 days", (await locker.MIN_LOCK_DURATION()) === BigInt(180 * 24 * 60 * 60), "");
    const lockerFns = locker.interface.fragments
      .filter((f) => f.type === "function")
      .map((f) => (f as { name: string }).name);
    push(
      "locker has no admin bypass",
      !lockerFns.some((n) => ["owner", "grantRole", "sweep", "rescue", "emergencyWithdraw"].includes(n)),
      lockerFns.join(","),
    );
  }

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
