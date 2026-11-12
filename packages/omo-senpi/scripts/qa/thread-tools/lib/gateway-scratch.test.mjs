import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createScratchLayout } from "./scratch-layout.mjs"

// senpi >= 2026.11.10-3 refuses a group-writable RPC key directory (unsafe_key_record); the shared QA hosts run
// under umask 002, so the scratch agent dir must be tightened regardless of the caller's umask.
test("#given a permissive umask #when the scratch layout is created #then its agent dir is owner-only", () => {
  const previous = process.umask(0o002)
  const dir = mkdtempSync(join(tmpdir(), "qa-scratch-layout-"))
  try {
    const { agentDir } = createScratchLayout(dir)
    expect(statSync(agentDir).mode & 0o777).toBe(0o700)
  } finally {
    process.umask(previous)
    rmSync(dir, { recursive: true, force: true })
  }
})
