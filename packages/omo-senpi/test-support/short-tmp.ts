import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, parse } from "node:path"

/**
 * A short temp root for tests that create unix sockets or model a darwin socket path: darwin caps a socket path near
 * 104 bytes, so POSIX keeps `/tmp`. win32 has no `/tmp`, and its OS temp dir is a long per-user path that pushes a
 * modelled shard socket past that cap, so it uses the temp dir's drive root (`C:\`). Tests remove what they create.
 */
const SHORT_TMP_ROOT = process.platform === "win32" ? parse(tmpdir()).root : "/tmp"

/** mkdtempSync under SHORT_TMP_ROOT. */
export function shortTempDir(prefix: string): string {
  return mkdtempSync(join(SHORT_TMP_ROOT, prefix))
}
