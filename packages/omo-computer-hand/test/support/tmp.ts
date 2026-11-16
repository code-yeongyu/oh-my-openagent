import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach } from "vitest"

/** A fresh temp dir per test, removed after it. */
export function tempDirs(prefix: string): () => string {
  const made: string[] = []
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
  })
  return () => {
    const dir = mkdtempSync(join(tmpdir(), prefix))
    made.push(dir)
    return dir
  }
}

/**
 * A fresh owner-only (0700) dir per test under a SHORT base, for socket files: a Unix socket path
 * is capped near 108 bytes, so a long TMPDIR must not decide whether a socket test can bind.
 */
export function socketDirs(prefix: string): () => string {
  const made: string[] = []
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
  })
  return () => {
    const dir = mkdtempSync(join(process.platform === "win32" ? tmpdir() : "/tmp", prefix))
    made.push(dir)
    return dir
  }
}
