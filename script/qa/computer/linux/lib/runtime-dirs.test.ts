// Every session hands its processes and the engine a fresh private runtime and state
// directory under the run directory, so nothing depends on the host having /run/user/<uid>.
import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"
import { expect, test } from "bun:test"

import { privateDirs } from "./runtime-dirs.ts"

test("a session's runtime and state directories are fresh and inside the run directory", () => {
  const runDir = mkdtempSync(join(tmpdir(), "r47-dirs-"))
  try {
    const dirs = privateDirs(runDir)
    for (const dir of [dirs.XDG_RUNTIME_DIR, dirs.XDG_STATE_HOME]) {
      expect(dir.startsWith(`${runDir}${sep}`)).toBe(true)
      expect(statSync(dir).isDirectory()).toBe(true)
    }
    expect(dirs.XDG_RUNTIME_DIR).not.toBe(dirs.XDG_STATE_HOME)
  } finally {
    rmSync(runDir, { recursive: true, force: true })
  }
})

// Linux only: mode 0700 is a POSIX permission contract; Windows reports 0o666 for directories.
test.skipIf(process.platform === "win32")("a session's runtime and state directories are private (0700)", () => {
  const runDir = mkdtempSync(join(tmpdir(), "r47-dirs-"))
  try {
    const dirs = privateDirs(runDir)
    for (const dir of [dirs.XDG_RUNTIME_DIR, dirs.XDG_STATE_HOME]) expect(statSync(dir).mode & 0o777).toBe(0o700)
  } finally {
    rmSync(runDir, { recursive: true, force: true })
  }
})

test("each session start gets its own directories", () => {
  const runDir = mkdtempSync(join(tmpdir(), "r47-dirs-"))
  try {
    expect(privateDirs(runDir).XDG_RUNTIME_DIR).not.toBe(privateDirs(runDir).XDG_RUNTIME_DIR)
  } finally {
    rmSync(runDir, { recursive: true, force: true })
  }
})
