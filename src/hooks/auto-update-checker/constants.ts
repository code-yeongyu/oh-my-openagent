import * as path from "node:path"
import * as os from "node:os"
import { getOpenCodeCacheDir } from "../../shared/data-path"
import { getOpenCodeConfigDir } from "../../shared/opencode-config-dir"

export const PACKAGE_NAME = "oh-my-opencode"
/**
 * All package names the canonical plugin may be published under.
 *
 * The package is published to npm as both `oh-my-opencode` (legacy canonical)
 * and `oh-my-openagent` (current canonical). Any code that *reads* an
 * installed package.json or walks up from an import path must accept both,
 * because the installed name depends on which package the user added to
 * their config. Code that *writes* continues to use {@link PACKAGE_NAME}.
 */
export const ACCEPTED_PACKAGE_NAMES = ["oh-my-opencode", "oh-my-openagent"] as const
export const NPM_REGISTRY_URL = `https://registry.npmjs.org/-/package/${PACKAGE_NAME}/dist-tags`
export const NPM_FETCH_TIMEOUT = 5000

export const CACHE_ROOT_DIR = getOpenCodeCacheDir()
export const CACHE_DIR = path.join(CACHE_ROOT_DIR, "packages")
export const VERSION_FILE = path.join(CACHE_ROOT_DIR, "version")

export function getWindowsAppdataDir(): string | null {
  if (process.platform !== "win32") return null
  return process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming")
}

export function getUserConfigDir(): string {
  return getOpenCodeConfigDir({ binary: "opencode" })
}

export function getUserOpencodeConfig(): string {
  return path.join(getUserConfigDir(), "opencode.json")
}

export function getUserOpencodeConfigJsonc(): string {
  return path.join(getUserConfigDir(), "opencode.jsonc")
}

export const INSTALLED_PACKAGE_JSON = path.join(
  CACHE_DIR,
  "node_modules",
  PACKAGE_NAME,
  "package.json"
)

/**
 * Candidate paths where the installed package.json may live, in priority order.
 * Readers should try each path in order and stop on the first success.
 */
export const INSTALLED_PACKAGE_JSON_CANDIDATES = ACCEPTED_PACKAGE_NAMES.map(
  name => path.join(CACHE_DIR, "node_modules", name, "package.json")
)
