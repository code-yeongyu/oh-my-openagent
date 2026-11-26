// The fail-fast contract of the engine peer: an engine that exits before answering fails
// the call in milliseconds, naming its stderr line - never a 20 s timeout.
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "bun:test"

import { Engine, EngineDied } from "./engine.ts"

const EXITING_ENGINE = `#!/bin/sh
echo "OMO_COMPUTER_RUNTIME_DIR is honoured only with OMO_COMPUTER_BACKEND=fake" >&2
exit 2
`

test("an engine that exits at once fails fast with its stderr", async () => {
  const dir = mkdtempSync(join(tmpdir(), "r47-engine-"))
  try {
    const binary = join(dir, "engine")
    writeFileSync(binary, EXITING_ENGINE)
    chmodSync(binary, 0o755)
    const engine = new Engine(binary, {})
    const started = Date.now()
    let error: unknown
    try {
      await engine.call("session.open", {})
    } catch (thrown) {
      error = thrown
    }
    const elapsedMs = Date.now() - started
    expect(error).toBeInstanceOf(EngineDied)
    expect((error as Error).message).toContain("honoured only with")
    expect(elapsedMs).toBeLessThan(1000)
    await engine.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
