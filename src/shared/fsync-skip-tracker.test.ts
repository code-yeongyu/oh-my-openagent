import { beforeEach, describe, expect, it } from "bun:test"

import {
  clearAllSkips,
  drainSkipsAfter,
  recordFsyncSkip,
} from "./fsync-skip-tracker"

type PathClassification =
  | "icloud"
  | "onedrive"
  | "desktop-sync"
  | "network-drive"
  | "unknown"

function recordSkip(index: number, pathClassification: PathClassification = "unknown"): void {
  recordFsyncSkip({
    filePath: `/tmp/file-${index}.txt`,
    contextLabel: `atomicWrite:/tmp/file-${index}.txt`,
    errorCode: "EPERM",
    message: "operation not permitted",
    pathClassification,
  })
}

describe("fsync-skip-tracker", () => {
  beforeEach(() => {
    clearAllSkips()
  })

  it("recordFsyncSkip adds entry with timestamp", () => {
    const before = Date.now()
    recordSkip(1)
    const entries = drainSkipsAfter(0)

    expect(entries).toHaveLength(1)
    expect(entries[0]?.filePath).toBe("/tmp/file-1.txt")
    expect(entries[0]?.timestamp).toBeGreaterThanOrEqual(before)
  })

  it("drainSkipsAfter(timestamp) returns entries strictly after the timestamp", async () => {
    recordSkip(1)
    const firstTimestamp = Date.now()

    await Bun.sleep(2)

    recordSkip(2)
    const drained = drainSkipsAfter(firstTimestamp)
    expect(drained).toHaveLength(1)
    expect(drained[0]?.filePath).toBe("/tmp/file-2.txt")
  })

  it("drainSkipsAfter removes drained entries from buffer", () => {
    recordSkip(1)
    recordSkip(2)

    const drained = drainSkipsAfter(0)
    expect(drained).toHaveLength(2)
    expect(drainSkipsAfter(0)).toEqual([])
  })

  it("buffer is bounded to max 200 entries and drops oldest on overflow", () => {
    for (let index = 1; index <= 205; index += 1) {
      recordSkip(index)
    }

    const drained = drainSkipsAfter(0)
    expect(drained).toHaveLength(200)
    expect(drained[0]?.filePath).toBe("/tmp/file-6.txt")
    expect(drained[199]?.filePath).toBe("/tmp/file-205.txt")
  })

  it("multiple records with same path are kept", () => {
    recordSkip(1)
    recordFsyncSkip({
      filePath: "/tmp/file-1.txt",
      contextLabel: "acquireLock:/tmp/file-1.txt",
      errorCode: "EPERM",
      message: "second",
      pathClassification: "unknown",
    })

    const drained = drainSkipsAfter(0)
    expect(drained).toHaveLength(2)
    expect(drained[0]?.filePath).toBe("/tmp/file-1.txt")
    expect(drained[1]?.filePath).toBe("/tmp/file-1.txt")
  })

  it("drainSkipsAfter(0) returns all entries", () => {
    recordSkip(1)
    recordSkip(2)

    const drained = drainSkipsAfter(0)
    expect(drained).toHaveLength(2)
  })

  it("empty buffer returns empty array", () => {
    expect(drainSkipsAfter(0)).toEqual([])
  })
})
