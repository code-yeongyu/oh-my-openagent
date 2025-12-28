import * as path from "node:path"
import * as os from "node:os"

/**
 * Returns the user-level data directory.
 * Matches OpenCode's behavior via xdg-basedir:
 * - All platforms: XDG_DATA_HOME or ~/.local/share
 *
 * Note: OpenCode uses xdg-basedir which returns ~/.local/share on ALL platforms
 * including Windows, so we match that behavior exactly.
 */
export function getDataDir(): string {
  return process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share")
}

/**
 * Returns the OpenCode storage directory path.
 * All platforms: ~/.local/share/opencode/storage
 */
export function getOpenCodeStorageDir(): string {
  return path.join(getDataDir(), "opencode", "storage")
}
