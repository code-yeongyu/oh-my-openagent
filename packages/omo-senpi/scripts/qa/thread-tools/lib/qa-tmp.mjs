import { tmpdir } from "node:os"

/**
 * The root every thread-tool QA path (kit, sandboxes, evidence) lives under. POSIX keeps the short
 * `/tmp` so the unix sockets a sandbox creates stay under the sun_path limit (macOS's `os.tmpdir()`
 * alone is about 50 bytes). Windows has no `/tmp`, so it uses the OS temp dir; its named pipes have
 * no such limit.
 */
export function qaTmpRoot(platform = process.platform, osTmpdir = tmpdir) {
  return platform === "win32" ? osTmpdir() : "/tmp"
}

export const QA_TMP_ROOT = qaTmpRoot()
