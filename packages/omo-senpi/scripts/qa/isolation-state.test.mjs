import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { changedSnapshotPaths, snapshotDirectory, snapshotProtectedState } from "./isolation-state.mjs"

test("#given protected and volatile files #when snapshots are compared #then only protected path changes affect isolation", () => {
  const root = mkdtempSync(join(tmpdir(), "omo-senpi-protected-state-"))
  try {
    writeFileSync(join(root, "auth.json"), "first-secret\n")
    writeFileSync(join(root, "senpi-debug.log"), "before\n")
    const before = snapshotProtectedState(root)

    writeFileSync(join(root, "auth.json"), "second-secret\n")
    writeFileSync(join(root, "senpi-debug.log"), "after\n")

    expect(changedSnapshotPaths(before, snapshotProtectedState(root))).toEqual(["auth.json"])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("#given nested files within the observation bounds #when scanned #then the full-tree observation is complete", () => {
  const root = mkdtempSync(join(tmpdir(), "omo-senpi-tree-scan-"))
  try {
    mkdirSync(join(root, "sessions"), { recursive: true })
    writeFileSync(join(root, "settings.json"), "{}\n")
    writeFileSync(join(root, "sessions", "active.jsonl"), "event\n")

    const scan = snapshotDirectory(root)

    expect(scan.complete).toBe(true)
    expect(scan.truncated).toBe(false)
    expect(scan.errors).toEqual([])
    expect([...scan.snapshot.keys()]).toEqual(["sessions/active.jsonl", "settings.json"])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("#given a tree beyond the file bound #when observed #then truncation is explicit and never complete", () => {
  const root = mkdtempSync(join(tmpdir(), "omo-senpi-tree-bound-"))
  try {
    writeFileSync(join(root, "a.jsonl"), "a\n")
    writeFileSync(join(root, "b.jsonl"), "b\n")

    const scan = snapshotDirectory(root, { maxFiles: 1, maxBytes: 1024 })

    expect(scan.complete).toBe(false)
    expect(scan.truncated).toBe(true)
    expect(scan.errors).toEqual([])
    expect(scan.snapshot.size).toBe(1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
