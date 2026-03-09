// postinstall.mjs
// Runs after npm install to verify platform binary is available
// and invalidate opencode's plugin cache so the new version is picked up on next launch.

import { createRequire } from "node:module";
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
 * Invalidate opencode's plugin cache so the updated version is resolved on next launch.
 *
 * opencode installs plugins into ~/.cache/opencode/node_modules/ with its own bun.lock.
 * When a user runs `bun install -g oh-my-opencode`, only the global copy is updated
 * while the cached copy remains stale. Removing the cached module and lockfile forces
 * opencode to re-resolve "oh-my-opencode@latest" on next startup.
 */
async function invalidateOpenCodePluginCache() {
  const cacheBase = join(homedir(), ".cache", "opencode");
  const targets = [
    join(cacheBase, "node_modules", "oh-my-opencode"),
    join(cacheBase, "bun.lock"),
  ];

  for (const target of targets) {
    try {
      await rm(target, { recursive: true, force: true });
    } catch {
      // Cache may not exist yet (fresh install) - safe to ignore
    }
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

main();
