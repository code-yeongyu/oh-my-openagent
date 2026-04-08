import * as path from "node:path"
import * as os from "node:os"
import { getOpenCodeCacheDir } from "../../shared/data-path"
import { getOpenCodeConfigDir } from "../../shared/opencode-config-dir"

export const PACKAGE_NAME = "oh-my-opencode"
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
