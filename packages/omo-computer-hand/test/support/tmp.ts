import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach } from "vitest"

/** A fresh owner-only (0700) dir per test under `base`, removed after it. */
function freshDirs(base: string, prefix: string): () => string {
  const made: string[] = []
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
  })
  return () => {
    const dir = mkdtempSync(join(base, prefix))
    made.push(dir)
    return dir
  }
}

/** A fresh temp dir per test, removed after it. */
export function tempDirs(prefix: string): () => string {
  return freshDirs(tmpdir(), prefix)
}

/**
 * The same under a SHORT base, for socket files: a Unix socket path is capped near 108 bytes, so a
 * long TMPDIR must not decide whether a socket test can bind.
 */
export function socketDirs(prefix: string): () => string {
  // The real path: macOS's /tmp is a link, and the host API refuses a socket dir under a linked parent.
  return freshDirs(process.platform === "win32" ? tmpdir() : realpathSync("/tmp"), prefix)
}
