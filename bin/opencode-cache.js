// bin/opencode-cache.js
// Refreshes OpenCode's plugin cache after a global install so it stays "hot".
// Deleting alone (PR #4640) leaves the cache cold; OpenCode's cold-cache
// install path can then deadlock under Bun, hanging at "loading plugin" (#5050).

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const EXACT_SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

const INSTALL_TIMEOUT_MS = 180_000;

/**
 * Install commands tried in order. `--ignore-scripts` is mandatory: it keeps
 * the nested install from re-running this package's own postinstall
 * (no recursion) and mirrors how OpenCode itself installs plugin specs
 * (Arborist is invoked with `ignoreScripts: true`).
 */
const INSTALL_COMMANDS = [
  { command: "bun", args: ["install", "--ignore-scripts"] },
  { command: "npm", args: ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"] },
];

/**
 * @param {string} requested Version part of a cache spec dir name (after "@").
 * @returns {boolean} true when it pins an exact semver, false for dist-tags/ranges.
 */
export function isExactVersion(requested) {
  return EXACT_SEMVER_PATTERN.test(requested);
}

/**
 * Default dependency installer: runs the first available package manager in
 * the spec directory. Returns false on spawn failure, non-zero exit, or
 * timeout so callers can fall back to removing the directory.
 *
 * @param {{ directory: string }} input
 * @returns {boolean}
 */
export function runDependencyInstall({ directory }) {
  for (const { command, args } of INSTALL_COMMANDS) {
    const result = spawnSync(command, args, {
      cwd: directory,
      stdio: "ignore",
      timeout: INSTALL_TIMEOUT_MS,
      shell: process.platform === "win32",
    });
    if (result.error && /** @type {NodeJS.ErrnoException} */ (result.error).code === "ENOENT") {
      continue;
    }
    return !result.error && result.status === 0;
  }
  return false;
}

/**
 * Refresh every OpenCode plugin cache spec dir (both `<cacheDir>/<name>@...` and
 * `<cacheDir>/packages/<name>@...` layouts): delete the stale copy, rebuild it
 * with a manifest pinning the right version (exact specs keep their pin;
 * dist-tags/ranges pin the just-installed version), and reinstall deps. On
 * failure the dir is removed, degrading to the old cold-cache behaviour.
 *
 * @param {object} input
 * @param {string} input.cacheDir OpenCode cache root (e.g. ~/.cache/opencode).
 * @param {string[]} input.packageNames Plugin package names to refresh.
 * @param {string | null} input.installedVersion Version that was just installed.
 * @param {(input: { directory: string }) => boolean} [input.installDependencies]
 * @returns {{ refreshed: string[], removed: string[] }} Spec dir paths by outcome.
 */
export function refreshOpenCodePluginCache({
  cacheDir,
  packageNames,
  installedVersion,
  installDependencies = runDependencyInstall,
}) {
  /** @type {{ refreshed: string[], removed: string[] }} */
  const summary = { refreshed: [], removed: [] };
  const parentDirs = [cacheDir, join(cacheDir, "packages")];

  for (const parentDir of parentDirs) {
    let entries;
    try {
      entries = readdirSync(parentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const packageName = packageNames.find((name) => entry.name.startsWith(`${name}@`));
      if (!packageName) continue;

      const specPath = join(parentDir, entry.name);
      const requested = entry.name.slice(packageName.length + 1);
      const version = isExactVersion(requested) ? requested : installedVersion;

      // A copy we cannot delete is the pre-#4640 stale-cache situation;
      // leave it for OpenCode rather than corrupting it half-way.
      if (!removeDirectory(specPath)) continue;

      if (!version) {
        summary.removed.push(specPath);
        continue;
      }

      if (repopulateSpecDir({ specPath, packageName, version, installDependencies })) {
        summary.refreshed.push(specPath);
      } else {
        // Best effort: worst case OpenCode finds a cold cache and reinstalls.
        removeDirectory(specPath);
        summary.removed.push(specPath);
      }
    }
  }

  return summary;
}

/**
 * @param {string} path
 * @returns {boolean} true when the directory no longer exists.
 */
function removeDirectory(path) {
  try {
    rmSync(path, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {object} input
 * @param {string} input.specPath
 * @param {string} input.packageName
 * @param {string} input.version
 * @param {(input: { directory: string }) => boolean} input.installDependencies
 * @returns {boolean} true when the spec dir contains a loadable package copy.
 */
function repopulateSpecDir({ specPath, packageName, version, installDependencies }) {
  try {
    mkdirSync(specPath, { recursive: true });
    const manifest = { dependencies: { [packageName]: version } };
    writeFileSync(join(specPath, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    if (!installDependencies({ directory: specPath })) {
      return false;
    }
    return existsSync(join(specPath, "node_modules", packageName, "package.json"));
  } catch {
    return false;
  }
}
