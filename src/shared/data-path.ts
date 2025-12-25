import * as path from "node:path"
import * as os from "node:os"

/**
 * Returns the user-level data directory based on the OS.
 * - Linux/macOS: XDG_DATA_HOME or ~/.local/share
 * - Windows: %LOCALAPPDATA%
 *
 * This follows XDG Base Directory specification on Unix systems
 * and Windows conventions on Windows.
 */
export function getDataDir(): string {
  if (process.platform === "win32") {
    // Windows: Use %LOCALAPPDATA% (e.g., C:\Users\Username\AppData\Local)
    return process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local")
  }

  // Unix: Use XDG_DATA_HOME or fallback to ~/.local/share
  return process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share")
}

/**
 * Returns the OpenCode storage directory path.
 * - Linux/macOS: ~/.local/share/opencode/storage
 * - Windows: %LOCALAPPDATA%\opencode\storage
 */
export function getOpenCodeStorageDir(): string {
  return path.join(getDataDir(), "opencode", "storage")
}
