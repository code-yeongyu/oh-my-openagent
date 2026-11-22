import { execFileSync } from "node:child_process"
import { updateTarget } from "./package-paths.js"

/**
 * Install scripts npm >= 11 blocks by default that this package's install is known-safe without
 * (#9281): esbuild's postinstall only copies the platform binary its optionalDependencies already
 * provide, @google/genai's preinstall echoes a no-op, protobufjs' postinstall is optional. The
 * printed command carries the package spec too, so it runs as-is, unlike npm's own suggestion.
 */
export const SAFE_INSTALL_SCRIPTS = ["esbuild", "@google/genai", "protobufjs"]

/** The version probe may not hold `omo update` longer than this; a silent npm counts as unknown. */
export const NPM_PROBE_TIMEOUT_MS = 5000

/**
 * npm's major version, or 0 when npm does not answer within the bound.
 *
 * @param {(file: string, args: string[], options: object) => string} [exec]
 */
export function npmMajorVersion(exec = execFileSync) {
  try {
    const version = exec("npm", ["--version"], {
      encoding: "utf8",
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: NPM_PROBE_TIMEOUT_MS,
      windowsHide: true,
    })
    return Number.parseInt(version.split(".")[0], 10) || 0
  } catch {
    return 0
  }
}

/**
 * Builds the update command for the install at `root`. The manager is decided first; only an npm
 * install asks npm for its version (once), and only npm >= 11 gets the allow-scripts option.
 *
 * @param {{ root?: string, platform?: NodeJS.Platform, npmMajor?: () => number }} [options]
 * @returns {(targetVersion?: string) => ReturnType<typeof updateTarget>}
 */
export function createUpdateResolver({ root, platform, npmMajor = npmMajorVersion } = {}) {
  let major
  return (targetVersion) => {
    const plain = updateTarget(root, platform, undefined, undefined, undefined, targetVersion)
    if (plain.manager !== "npm") return plain
    major ??= npmMajor()
    if (major < 11) return plain
    return updateTarget(root, platform, undefined, undefined, undefined, targetVersion, SAFE_INSTALL_SCRIPTS)
  }
}
