import { expect, test } from "bun:test"
import { appendFileSync, closeSync, fstatSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, readSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as isolationState from "./isolation-state.mjs"

const { changedSnapshotPaths, snapshotDirectory, snapshotProtectedState } = isolationState

test("#given protected and volatile files #when snapshots are compared #then only protected path changes affect isolation", () => {
  const root = mkdtempSync(join(tmpdir(), "omo-senpi-protected-state-"))
  try {
    writeFileSync(join(root, "auth.json"), "first-secret\n")
    writeFileSync(join(root, "senpi-debug.log"), "before\n")
    const before = snapshotProtectedState(root)

    writeFileSync(join(root, "auth.json"), "second-secret\n")
    writeFileSync(join(root, "senpi-debug.log"), "after\n")

    expect(changedSnapshotPaths(before.snapshot, snapshotProtectedState(root).snapshot)).toEqual(["auth.json"])
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


test("#given identical protected read failures #when snapshots are compared #then isolation fails closed with structured relative errors", () => {
  const root = mkdtempSync(join(tmpdir(), "omo-senpi-protected-error-"))
  try {
    writeFileSync(join(root, "auth.json"), "secret\n")
    const deniedRead = () => {
      const error = new Error("denied")
      error.code = "EACCES"
      throw error
    }

    const before = snapshotProtectedState(root, deniedRead)
    const after = snapshotProtectedState(root, deniedRead)

    expect(before.complete).toBe(false)
    expect(before.errors).toEqual([{ path: "auth.json", code: "EACCES" }])
    expect(changedSnapshotPaths(before.snapshot, after.snapshot)).toEqual([])
    expect(isolationState.protectedSnapshotsUntouched?.(before, after)).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("#given files exceed the byte budget #when observed #then descriptor reads never exceed maxBytes", () => {
  const root = mkdtempSync(join(tmpdir(), "omo-senpi-byte-bound-"))
  try {
    writeFileSync(join(root, "a.bin"), "1234")
    writeFileSync(join(root, "b.bin"), "12345678")
    let bytesRead = 0
    const io = {
      openSync,
      closeSync,
      fstatSync,
      statSync,
      readSync(fd, buffer, offset, length, position) {
        const count = readSync(fd, buffer, offset, length, position)
        bytesRead += count
        return count
      },
    }

    const scan = snapshotDirectory(root, { maxFiles: 10, maxBytes: 6, maxEntries: 10 }, io)

    expect(bytesRead).toBe(4)
    expect(scan.complete).toBe(false)
    expect(scan.truncated).toBe(true)
    expect([...scan.snapshot.keys()]).toEqual(["a.bin"])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("#given a file shrinks after traversal #when observed #then short read is explicit and incomplete", () => {
  const root = mkdtempSync(join(tmpdir(), "omo-senpi-short-read-"))
  try {
    const path = join(root, "state.json")
    writeFileSync(path, "12345678")
    let truncated = false
    const io = {
      closeSync,
      fstatSync,
      statSync,
      openSync(file) {
        return openSync(file, "r+")
      },
      readSync(fd, buffer, offset, length, position) {
        if (!truncated) {
          truncated = true
          ftruncateSync(fd, 0)
        }
        return readSync(fd, buffer, offset, length, position)
      },
    }

    const scan = snapshotDirectory(root, { maxFiles: 10, maxBytes: 1024, maxEntries: 10 }, io)

    expect(scan.complete).toBe(false)
    expect(scan.errors).toEqual([{ path: "state.json", code: "SHORT_READ" }])
    expect(scan.snapshot.size).toBe(0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("#given a file grows while hashing #when observed #then growth is explicit and incomplete", () => {
  const root = mkdtempSync(join(tmpdir(), "omo-senpi-growth-"))
  try {
    const path = join(root, "state.json")
    writeFileSync(path, "1234")
    let grew = false
    const io = {
      openSync,
      closeSync,
      fstatSync,
      statSync,
      readSync(fd, buffer, offset, length, position) {
        const count = readSync(fd, buffer, offset, length, position)
        if (!grew) {
          grew = true
          appendFileSync(path, "5678")
        }
        return count
      },
    }

    const scan = snapshotDirectory(root, { maxFiles: 10, maxBytes: 1024, maxEntries: 10 }, io)

    expect(scan.complete).toBe(false)
    expect(scan.errors).toEqual([{ path: "state.json", code: "FILE_CHANGED" }])
    expect(scan.snapshot.size).toBe(0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("#given a path is replaced after open #when observed #then replacement is explicit and incomplete", () => {
  const root = mkdtempSync(join(tmpdir(), "omo-senpi-replacement-"))
  try {
    const path = join(root, "state.json")
    const moved = join(root, "state.old")
    writeFileSync(path, "1234")
    let replaced = false
    const io = {
      closeSync,
      fstatSync,
      readSync,
      statSync,
      openSync(file, flags) {
        const fd = openSync(file, flags)
        if (!replaced) {
          replaced = true
          renameSync(path, moved)
          writeFileSync(path, "abcd")
        }
        return fd
      },
    }

    const scan = snapshotDirectory(root, { maxFiles: 10, maxBytes: 1024, maxEntries: 10 }, io)

    expect(scan.complete).toBe(false)
    expect(scan.errors).toEqual([{ path: "state.json", code: "FILE_REPLACED" }])
    expect(scan.snapshot.size).toBe(0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
