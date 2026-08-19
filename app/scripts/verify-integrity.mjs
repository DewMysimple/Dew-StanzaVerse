import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(process.argv[2] ?? ".");
const pristineRoot = resolve(process.argv[3] ?? "../sources/original-extraction");
const manifestPath = join(projectRoot, "src", "config", "source-assets.manifest.json");
const outputPath = join(projectRoot, ".artifacts", "qa", "integrity-report.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
const listFiles = (root) => {
  const result = [];
  const visit = (directory) => readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) visit(path);
    else if (entry.isFile()) result.push(path);
  });
  visit(root);
  return result;
};

const pristineHashes = new Set(listFiles(pristineRoot).map(hash));
const results = manifest.assets.map((asset) => {
  const path = join(projectRoot, "public", "assets", asset.path);
  const actualHash = existsSync(path) ? hash(path) : null;
  const actualBytes = existsSync(path) ? statSync(path).size : null;
  return {
    path: asset.path,
    bytesMatch: actualBytes === asset.bytes,
    hashMatch: actualHash === asset.sha256,
    existsInPristineExtraction: actualHash != null && pristineHashes.has(actualHash),
  };
});
const report = {
  checkedAt: new Date().toISOString(),
  projectRoot,
  pristineRoot,
  assetCount: results.length,
  passed: results.every((item) => item.bytesMatch && item.hashMatch && item.existsInPristineExtraction),
  failures: results.filter((item) => !item.bytesMatch || !item.hashMatch || !item.existsInPristineExtraction),
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
