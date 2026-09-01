import { describe, expect, test } from "bun:test"
import path from "node:path"

import {
  LOCK_DOMAINS,
  factsQueueLockPath,
  factsRunsLockPath,
  memoryUsageLockPath,
  memoryWriterLockPath,
  noticeLockPath,
  reflectionSchedulerLockPath,
  runFinalizationLockPath,
  skillsUsageLockPath,
  transcriptStateLockPath,
} from "./index"

describe("lock domain paths", () => {
  test("#given the runtime lock directory #when domain paths are resolved #then every protocol has a stable confined name", () => {
    // #given
    const locksDirectory = path.join("runtime", "locks")

    // #when
    const paths = [
      memoryWriterLockPath(locksDirectory),
      reflectionSchedulerLockPath(locksDirectory),
      skillsUsageLockPath(locksDirectory),
      memoryUsageLockPath(locksDirectory),
      transcriptStateLockPath(locksDirectory, "conversation/../one"),
      factsQueueLockPath(locksDirectory),
      factsRunsLockPath(locksDirectory),
      noticeLockPath(locksDirectory),
      runFinalizationLockPath(locksDirectory, "run-123"),
    ]

    // #then
    expect(LOCK_DOMAINS).toEqual([
      "memory-write",
      "reflection-scheduler",
      "reflection-finalize",
      "transcript-state",
      "skills-usage",
      "memory-usage",
      "facts-queue",
      "facts-runs",
      "notice",
    ])
    expect(paths[0]).toBe(path.join(locksDirectory, "memory-write.lock"))
    expect(paths[1]).toBe(path.join(locksDirectory, "reflection-scheduler.lock"))
    expect(paths[2]).toBe(path.join(locksDirectory, "skills-usage.lock"))
    expect(paths[3]).toBe(path.join(locksDirectory, "memory-usage.lock"))
    expect(path.dirname(paths[4] ?? "")).toBe(locksDirectory)
    expect(path.basename(paths[4] ?? "")).toMatch(/^transcript-state-[a-f0-9]{16}\.lock$/)
    expect(paths[5]).toBe(path.join(locksDirectory, "facts-queue.lock"))
    expect(paths[6]).toBe(path.join(locksDirectory, "facts-runs.lock"))
    expect(paths[7]).toBe(path.join(locksDirectory, "notice.lock"))
    expect(paths[8]).toBe(path.join(locksDirectory, "finalize-run-123.lock"))
  })

  test("#given hostile and distinct run ids #when finalization paths are resolved #then names remain confined and distinct", () => {
    const locksDirectory = path.resolve("runtime", "locks")
    const hostile = runFinalizationLockPath(locksDirectory, "../../outside/run")
    const first = runFinalizationLockPath(locksDirectory, "run-one")
    const second = runFinalizationLockPath(locksDirectory, "run-two")

    expect(path.dirname(hostile)).toBe(locksDirectory)
    expect(path.basename(hostile)).toMatch(/^finalize-[a-zA-Z0-9._-]+\.lock$/)
    expect(hostile.startsWith(`${locksDirectory}${path.sep}`)).toBe(true)
    expect(first).not.toBe(second)
    expect(() => runFinalizationLockPath(locksDirectory, ".")).toThrow()
    expect(() => runFinalizationLockPath(locksDirectory, "..")).toThrow()
  })
})
