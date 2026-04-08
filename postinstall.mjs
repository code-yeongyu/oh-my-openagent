// postinstall.mjs
// Runs after npm install to verify platform binary is available

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { getPlatformPackageCandidates, getBinaryPath } from "./bin/platform.js";

const require = createRequire(import.meta.url);

const MIN_OPENCODE_VERSION = "1.4.0";

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

function getPackageBaseName() {
  try {
    const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
    return packageJson.name || "oh-my-opencode";
  } catch {
    return "oh-my-opencode";
  }
}

function main() {
  const { platform, arch } = process;
  const libcFamily = getLibcFamily();
  const packageBaseName = getPackageBaseName();

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

    console.log(`✓ oh-my-opencode binary installed for ${platform}-${arch} (${resolvedPackage})`);
  } catch (error) {
    console.warn(`⚠ oh-my-opencode: ${error.message}`);
    console.warn(`  The CLI may not work on this platform.`);
    // Don't fail installation - let user try anyway
  }
}

main();
