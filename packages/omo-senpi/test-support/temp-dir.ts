import { onTestFinished } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** A temp dir removed when the calling test finishes; call it from a test or a beforeEach (#9766). */
export function testTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
