#!/usr/bin/env node
// bin/oh-my-opencode.js
// Wrapper script that detects platform and spawns the correct binary

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getPlatformPackageCandidates,
  getBinaryPath,
  getPackageBareName,
  resolvePlatformPackageBaseName,
} from "./platform.js";

const require = createRequire(import.meta.url);

/**
 * Detect libc family on Linux
 * @returns {string | null} 'glibc', 'musl', or null if detection fails
 */
function getLibcFamily() {
  if (process.platform !== "linux") {
    return undefined; // Not needed on non-Linux
  }
  
  try {
    const detectLibc = require("detect-libc");
    return detectLibc.familySync();
  } catch {
    // detect-libc not available
    return null;
  }
}

function supportsAvx2() {
  if (process.arch !== "x64") {
    return null;
  }

  if (process.env.OH_MY_OPENCODE_FORCE_BASELINE === "1") {
    return false;
  }

  if (process.platform === "linux") {
    try {
      const cpuInfo = readFileSync("/proc/cpuinfo", "utf8").toLowerCase();
      return cpuInfo.includes("avx2");
    } catch {
      return null;
    }
  }

  if (process.platform === "darwin") {
    const probe = spawnSync("sysctl", ["-n", "machdep.cpu.leaf7_features"], {
      encoding: "utf8",
    });

    if (probe.error || probe.status !== 0) {
      return null;
    }

    return probe.stdout.toUpperCase().includes("AVX2");
  }

  return null;
}

function getSignalExitCode(signal) {
  const signalCodeByName = {
    SIGINT: 2,
    SIGILL: 4,
    SIGKILL: 9,
    SIGTERM: 15,
  };

  return 128 + (signalCodeByName[signal] ?? 1);
}

function getPackageBaseName() {
  return resolvePlatformPackageBaseName(getWrapperPackageName());
}

function getWrapperPackageName() {
  try {
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return packageJson.name || "oh-my-opencode";
  } catch {
    return "oh-my-opencode";
  }
}

function getWrapperPackageRoot() {
  return fileURLToPath(new URL("..", import.meta.url));
}

function maybeRunLazyCodexNodeInstaller(invocationName) {
  if (invocationName !== "lazycodex" && invocationName !== "lazycodex-ai") return false;
  const command = process.argv[2];
  if (command !== "update" && command !== "uninstall") return false;

  const installerPath = fileURLToPath(new URL("../packages/omo-codex/scripts/install-local.mjs", import.meta.url));
  if (!existsSync(installerPath)) return false;

  const result = spawnSync(process.execPath, [installerPath, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: {
      ...process.env,
      OMO_INVOCATION_NAME: invocationName,
      OMO_WRAPPER_PACKAGE_ROOT: getWrapperPackageRoot(),
    },
  });
  if (result.signal) {
    process.exit(getSignalExitCode(result.signal));
  }
  process.exit(result.status ?? 1);
}

/**
 * Determine which bin name the user invoked us with (oh-my-opencode, oh-my-openagent, omo, lazycodex).
 * Propagated to the compiled CLI binary via OMO_INVOCATION_NAME so it can route accordingly
 * (e.g. `lazycodex` defaults to the Codex install flow).
 * @returns {string}
 */
function getInvocationName(wrapperPackageName) {
  if (process.env.OMO_INVOCATION_NAME) {
    return process.env.OMO_INVOCATION_NAME;
  }
  const wrapperBareName = getPackageBareName(wrapperPackageName);
  if (wrapperBareName === "lazycodex" || wrapperBareName === "lazycodex-ai") {
    return wrapperBareName;
  }
  const argv1 = process.argv[1] ?? "";
  if (!argv1) {
    return "oh-my-opencode";
  }
  return basename(argv1, ".js").replace(/\.exe$/, "");
}

function main() {
  const { platform, arch } = process;
  const libcFamily = getLibcFamily();
  const wrapperPackageName = getWrapperPackageName();
  const invocationName = getInvocationName(wrapperPackageName);
  maybeRunLazyCodexNodeInstaller(invocationName);

  const packageBaseName = resolvePlatformPackageBaseName(wrapperPackageName);
  const avx2Supported = supportsAvx2();
  
  let packageCandidates;
  try {
    packageCandidates = getPlatformPackageCandidates({
      platform,
      arch,
      libcFamily,
      preferBaseline: avx2Supported === false,
      packageBaseName,
    });
  } catch (error) {
    console.error(`\noh-my-opencode: ${error.message}\n`);
    process.exit(1);
  }

  const resolvedBinaries = packageCandidates
    .map((pkg) => {
      try {
        return { pkg, binPath: require.resolve(getBinaryPath(pkg, platform)) };
      } catch {
        return null;
      }
    })
    .filter((entry) => entry !== null);

  if (resolvedBinaries.length === 0) {
    console.error(`\noh-my-opencode: Platform binary not installed.`);
    console.error(`\nYour platform: ${platform}-${arch}${libcFamily === "musl" ? "-musl" : ""}`);
    console.error(`Expected packages (in order): ${packageCandidates.join(", ")}`);
    console.error(`\nTo fix, run:`);
    console.error(`  npm install ${packageCandidates[0]}\n`);
    process.exit(1);
  }

  const childEnv = {
    ...process.env,
    OMO_INVOCATION_NAME: invocationName,
    OMO_WRAPPER_PACKAGE_ROOT: getWrapperPackageRoot(),
  };

  for (let index = 0; index < resolvedBinaries.length; index += 1) {
    const currentBinary = resolvedBinaries[index];
    const hasFallback = index < resolvedBinaries.length - 1;
    const result = spawnSync(process.execPath, [currentBinary.binPath, ...process.argv.slice(2)], {
      stdio: "inherit",
      env: childEnv,
    });

    if (result.error) {
      if (hasFallback) {
        continue;
      }

      console.error(`\noh-my-opencode: Failed to execute binary.`);
      console.error(`Error: ${result.error.message}\n`);
      process.exit(2);
    }

    if (result.signal === "SIGILL" && hasFallback) {
      continue;
    }

    if (result.signal) {
      process.exit(getSignalExitCode(result.signal));
    }

    process.exit(result.status ?? 1);
  }

  process.exit(1);
}

main();
