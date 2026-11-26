import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * A short temp root for tests that create unix sockets: darwin caps a socket path near 104 bytes, so POSIX keeps
 * `/tmp`. win32 has no `/tmp` (it would resolve to \\tmp on the drive root, which exists only if an earlier
 * test happened to create it), so it uses the OS temp dir, where sockets are named pipes and the cap does not apply.
 */
const SHORT_TMP_ROOT = process.platform === "win32" ? tmpdir() : "/tmp"

/** mkdtempSync under SHORT_TMP_ROOT. */
export function shortTempDir(prefix: string): string {
  return mkdtempSync(join(SHORT_TMP_ROOT, prefix))
}
