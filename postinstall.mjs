// postinstall.mjs
// Runs after npm install to verify platform binary is available

import { createRequire } from "node:module";
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

function main() {
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

main();
