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
