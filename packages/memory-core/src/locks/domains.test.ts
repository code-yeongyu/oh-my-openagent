import { describe, expect, test } from "bun:test"
import path from "node:path"

import {
  LOCK_DOMAINS,
  memoryWriterLockPath,
  reflectionSchedulerLockPath,
  transcriptStateLockPath,
} from "./index"

describe("lock domain paths", () => {
  test("#given the runtime lock directory #when domain paths are resolved #then all three protocols have stable confined names", () => {
    // #given
    const locksDirectory = path.join("runtime", "locks")

    // #when
    const paths = [
      memoryWriterLockPath(locksDirectory),
      reflectionSchedulerLockPath(locksDirectory),
      transcriptStateLockPath(locksDirectory, "conversation/../one"),
    ]

    // #then
    expect(LOCK_DOMAINS).toEqual(["memory-write", "reflection-scheduler", "transcript-state"])
    expect(paths[0]).toBe(path.join(locksDirectory, "memory-write.lock"))
    expect(paths[1]).toBe(path.join(locksDirectory, "reflection-scheduler.lock"))
    expect(path.dirname(paths[2] ?? "")).toBe(locksDirectory)
    expect(path.basename(paths[2] ?? "")).toMatch(/^transcript-state-[a-f0-9]{16}\.lock$/)
  })
})
