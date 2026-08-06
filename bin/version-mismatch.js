// bin/version-mismatch.js
// Detects platform binary version mismatch against the main package.
// Background: issue #3918 - `oh-my-opencode-windows-x64@3.9.0` could stay installed
// alongside `oh-my-opencode@4.0.0`, leaving the startup banner pinned to 3.9.0.

/**
 * Strips an optional leading "v" so callers can pass either "4.5.1" or "v4.5.1".
 * Pre-release suffixes (e.g. "-beta.1") are preserved because the release
 * workflow publishes prereleases as standalone versions on the `next` dist-tag,
 * and `oh-my-opencode@4.5.1-beta.1` paired with `oh-my-opencode-x64@4.5.1`
 * IS a real mismatch the wrapper would silently honour.
 *
 * @param {string} version
 * @returns {string} Full version with leading "v" stripped.
 */
function normalizeVersion(version) {
  return version.replace(/^v/, "");
}

/**
 * Detect a main / platform-binary version mismatch.
 *
 * Both versions must be known to report a mismatch; if either is null/undefined,
 * the check is skipped (returns null) rather than producing a false alarm.
 *
 * Comparison is exact on the full semver string (after stripping a leading "v"),
 * including any pre-release suffix. This means `4.5.1-beta.1` and `4.5.1` are
 * treated as DIFFERENT versions, matching the publish workflow that ships
 * prerelease builds to the `next` dist-tag alongside stable releases.
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
