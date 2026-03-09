// postinstall.mjs
// Runs after npm install to verify platform binary is available
// and invalidate opencode's plugin cache so the new version is picked up on next launch.

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { getPlatformPackageCandidates, getBinaryPath } from "./bin/platform.js";

const require = createRequire(import.meta.url);

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

/**
 * Resolve the opencode cache directory.
 *
 * opencode uses xdg-basedir on all platforms, so the cache path is always
 * $XDG_CACHE_HOME/opencode (defaults to ~/.cache/opencode).
 */
function getOpenCodeCacheDir() {
  return join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "opencode");
}

/**
 * Invalidate opencode's plugin cache so the updated version is resolved on next launch.
 *
 * opencode installs plugins into its cache with a separate bun.lock.
 * When a user runs `bun install -g oh-my-opencode`, only the global copy is updated
 * while the cached copy remains stale. Removing the cached module forces
 * opencode to re-resolve "oh-my-opencode@latest" on next startup.
 */
async function invalidateOpenCodePluginCache() {
  const cacheBase = getOpenCodeCacheDir();

  if (!existsSync(cacheBase)) {
    return;
  }

  const target = join(cacheBase, "node_modules", "oh-my-opencode");

  try {
    await rm(target, { recursive: true, force: true });
  } catch (error) {
    // force: true already handles ENOENT (missing files).
    // Real errors (EPERM, EBUSY) indicate the cache could not be cleared.
    console.warn(`⚠ oh-my-opencode: failed to clear cache at ${target}: ${error.message}`);
  }
}

function verifyPlatformBinary() {
  const { platform, arch } = process;
  const libcFamily = getLibcFamily();
  
  try {
    const packageCandidates = getPlatformPackageCandidates({
      platform,
      arch,
      libcFamily,
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

async function main() {
  verifyPlatformBinary();
  await invalidateOpenCodePluginCache();
}

main().catch(() => {
  // Postinstall must never fail the install process.
});
