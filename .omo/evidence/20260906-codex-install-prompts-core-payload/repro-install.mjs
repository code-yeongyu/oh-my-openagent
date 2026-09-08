#!/usr/bin/env node
// Repro driver: runs the PACKAGED codex install path from a published npm tarball
// against a fully isolated CODEX_HOME. Usage: node repro-install.mjs <extractedPackageRoot> <label>
import { mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const packageRoot = resolve(process.argv[2]);
const label = process.argv[3] ?? "run";
const sandbox = resolve(process.cwd(), `sandbox-${label}`);
const codexHome = resolve(sandbox, "codex-home");
const binDir = resolve(sandbox, "bin");
await mkdir(codexHome, { recursive: true });
await mkdir(binDir, { recursive: true });

const installer = await import(
  new URL(`file:///${packageRoot.replaceAll("\\\\", "/")}/packages/omo-codex/scripts/install-dist/install-local.mjs`).href
);

const env = { ...process.env, CODEX_HOME: codexHome, CODEX_LOCAL_BIN_DIR: binDir };
try {
  const result = await installer.installMarketplaceLocally({
    repoRoot: packageRoot,
    autonomousPermissions: true,
    env,
    log: (message) => console.log(`[install] ${message}`),
  });
  console.log(`RESULT: ok installed=${result.installed.length}`);
} catch (error) {
  console.log(`RESULT: FAILED ${error?.message ?? error}`);
  process.exitCode = 1;
}
console.log("codexHome entries:", (await readdir(codexHome).catch(() => [])).join(", "));
