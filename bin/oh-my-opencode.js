#!/usr/bin/env node
// bin/oh-my-opencode.js
// Wrapper script that detects platform and spawns the correct binary

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { getPlatformPackageCandidates, getBinaryPath } from "./platform.js";

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
  try {
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return packageJson.name || "oh-my-opencode";
  } catch {
    return "oh-my-opencode";
  }
}

function main() {
  const { platform, arch } = process;
  const libcFamily = getLibcFamily();
  const packageBaseName = getPackageBaseName();
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

  for (let index = 0; index < resolvedBinaries.length; index += 1) {
    const currentBinary = resolvedBinaries[index];
    const hasFallback = index < resolvedBinaries.length - 1;
    const result = spawnSync(currentBinary.binPath, process.argv.slice(2), {
      stdio: "inherit",
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
