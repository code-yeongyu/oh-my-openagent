// postinstall.mjs
// Runs after npm install to verify platform binary is available

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  getPlatformPackageCandidates,
  getBinaryPath,
  resolvePlatformPackageBaseName,
} from "./bin/platform.js";
import { refreshOpenCodePluginCache } from "./bin/opencode-cache.js";
import { detectPlatformBinaryMismatch } from "./bin/version-mismatch.js";

const require = createRequire(import.meta.url);

const MIN_OPENCODE_VERSION = "1.4.0";
const OPENCODE_PLUGIN_PACKAGES = ["oh-my-opencode", "oh-my-openagent"];

/**
 * Parse version string into numeric parts
 * @param {string} version
 * @returns {number[]}
 */
function parseVersion(version) {
  return version
    .replace(/^v/, "")
    .split("-")[0]
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}

/**
 * Compare two version strings
 * @param {string} current
 * @param {string} minimum
 * @returns {boolean} true if current >= minimum
 */
function compareVersions(current, minimum) {
  const currentParts = parseVersion(current);
  const minimumParts = parseVersion(minimum);
  const length = Math.max(currentParts.length, minimumParts.length);

  for (let index = 0; index < length; index++) {
    const currentPart = currentParts[index] ?? 0;
    const minimumPart = minimumParts[index] ?? 0;
    if (currentPart > minimumPart) return true;
    if (currentPart < minimumPart) return false;
  }

  return true;
}

/**
 * Check if opencode version meets minimum requirement
 * @returns {{ok: boolean, version: string | null}}
 */
function checkOpenCodeVersion() {
  try {
    const result = require("child_process").execSync("opencode --version", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    const version = result.trim();
    const ok = compareVersions(version, MIN_OPENCODE_VERSION);
    return { ok, version };
  } catch {
    return { ok: true, version: null };
  }
}

/**
 * Detect libc family on Linux
 */
function getLibcFamily() {
  if (process.platform !== "linux") {
    return undefined;
  }
  
  try {
    const detectLibc = require("detect-libc");
    return detectLibc.familySync();
  } catch {
    return null;
  }
}

function readMainPackageJson() {
  try {
    return JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
  } catch {
    return null;
  }
}

function getPackageBaseName() {
  const packageJson = readMainPackageJson();
  return resolvePlatformPackageBaseName(packageJson?.name || "oh-my-opencode");
}

function getMainPackageVersion() {
  const packageJson = readMainPackageJson();
  return packageJson?.version ?? null;
}

// Refresh (not just delete) the OpenCode plugin cache. Deleting alone leaves
// the cache cold, and OpenCode's cold-cache plugin install can deadlock under
// Bun, hanging OpenCode at startup (issue #5050). Best-effort: postinstall
// must never fail the package install.
function refreshPluginCache() {
  const cacheDir = join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "opencode");
  try {
    return refreshOpenCodePluginCache({
      cacheDir,
      packageNames: OPENCODE_PLUGIN_PACKAGES,
      installedVersion: getMainPackageVersion(),
    });
  } catch {
    return { refreshed: [], removed: [] };
  }
}

function readPlatformPackageVersion(pkg) {
  try {
    const platformPackageJsonPath = require.resolve(`${pkg}/package.json`);
    const packageJson = JSON.parse(readFileSync(platformPackageJsonPath, "utf8"));
    return packageJson.version ?? null;
  } catch {
    return null;
  }
}

function main() {
  const { platform, arch } = process;
  const libcFamily = getLibcFamily();
  const packageBaseName = getPackageBaseName();

  const cacheRefresh = refreshPluginCache();
  for (const specPath of cacheRefresh.removed) {
    console.warn(`oh-my-opencode: could not refresh OpenCode plugin cache at ${specPath}`);
    console.warn(`  OpenCode will reinstall the plugin on next startup.`);
  }

  // Check opencode version requirement
  const versionCheck = checkOpenCodeVersion();
  if (versionCheck.version && !versionCheck.ok) {
    console.warn(`⚠ oh-my-opencode requires OpenCode >= ${MIN_OPENCODE_VERSION}`);
    console.warn(`  Detected: ${versionCheck.version}`);
    console.warn(`  Please update OpenCode to avoid compatibility issues.`);
  }

  try {
    const packageCandidates = getPlatformPackageCandidates({
      platform,
      arch,
      libcFamily,
      packageBaseName,
    });

    const resolvedPackage = packageCandidates.find((pkg) => {
      try {
        require.resolve(getBinaryPath(pkg, platform));
        return true;
      } catch {
        return false;
      }
    });

    if (!resolvedPackage) {
      throw new Error(
        `No platform binary package installed. Tried: ${packageCandidates.join(", ")}`
      );
    }

    const mismatch = detectPlatformBinaryMismatch({
      mainVersion: getMainPackageVersion(),
      platformVersion: readPlatformPackageVersion(resolvedPackage),
      platformPackage: resolvedPackage,
    });
    if (mismatch) {
      console.warn(`⚠ oh-my-opencode platform binary version mismatch detected`);
      console.warn(`  ${packageBaseName}: ${mismatch.mainVersion}`);
      console.warn(`  ${mismatch.platformPackage}: ${mismatch.platformVersion}`);
      console.warn(`  The startup banner may show the stale version until the platform binary is updated.`);
      console.warn(`  Fix: npm install -g ${packageBaseName}@${mismatch.mainVersion} ${mismatch.platformPackage}@${mismatch.mainVersion}`);
    }

    console.log(`✓ oh-my-opencode binary installed for ${platform}-${arch} (${resolvedPackage})`);
  } catch (error) {
    console.warn(`⚠ oh-my-opencode: ${error.message}`);
    console.warn(`  The CLI may not work on this platform.`);
    // Don't fail installation - let user try anyway
  }
}

main();
