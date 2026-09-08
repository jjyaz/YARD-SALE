/* Copies compiled ABIs into the frontend as plain JSON. */
const fs = require("fs");
const path = require("path");

const names = ["YardSaleAssetRegistry", "YardTokenFactory", "YardCompanionToken"];
const artifacts = path.join(__dirname, "..", "artifacts", "contracts");
const outDir = path.join(__dirname, "..", "..", "src", "lib", "abi");
fs.mkdirSync(outDir, { recursive: true });

for (const name of names) {
  const artifactPath = path.join(artifacts, `${name}.sol`, `${name}.json`);
  if (!fs.existsSync(artifactPath)) {
    console.warn(`Missing artifact for ${name}. Run: npx hardhat compile`);
    continue;
  }
  const { abi } = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(abi, null, 2));
  console.log(`Exported ${name} ABI`);
}
