// bin/version-mismatch.js
// Detects platform binary version mismatch against the main package.
// Background: issue #3918 - `oh-my-opencode-windows-x64@3.9.0` could stay installed
// alongside `oh-my-opencode@4.0.0`, leaving the startup banner pinned to 3.9.0.

/**
 * @param {string} version
 * @returns {string} Version core (strips leading "v" and pre-release suffix).
 */
function normalizeVersion(version) {
  return version.replace(/^v/, "").split("-")[0];
}

/**
 * Detect a main / platform-binary version mismatch.
 *
 * Both versions must be known to report a mismatch; if either is null/undefined,
 * the check is skipped (returns null) rather than producing a false alarm.
 *
 * @param {object} input
 * @param {string | null | undefined} input.mainVersion
 * @param {string | null | undefined} input.platformVersion
 * @param {string} input.platformPackage
 * @returns {{ mainVersion: string, platformVersion: string, platformPackage: string } | null}
 */
export function detectPlatformBinaryMismatch({ mainVersion, platformVersion, platformPackage }) {
  if (!mainVersion || !platformVersion) {
    return null;
  }

  if (normalizeVersion(mainVersion) === normalizeVersion(platformVersion)) {
    return null;
  }

  return { mainVersion, platformVersion, platformPackage };
}
