import { describe, expect, setDefaultTimeout, test } from "bun:test"

import { acquireLock, createLockRecord, memoryWriterLockPath, releaseLock } from "@oh-my-opencode/memory-core"

import { createMemoryTools } from "./tools"
import { boundFixture, git, textOf } from "./tools.test-support"

// Each case initializes a real Git repo and drives writer-lock contention through git children.
// Match the 60s process test ceiling used by the supervisor suites: the 5s default is a fast-machine
// assumption, and on a loaded Windows runner the previous file's cleanup is billed to this budget.
setDefaultTimeout(60_000)

describe("memory tool execution", () => {
  test("#given the writer lock is held #when a tool executes #then the contention surfaces as an error result", async () => {
    // given
    const fixture = await boundFixture()
    await fixture.context.repoAccess.ensureRuntimeDirs()
    const holder = await createLockRecord("contending test process")
    const lockPath = memoryWriterLockPath(fixture.locksDirectory)
    await acquireLock(lockPath, holder)
    const [memoryTool] = createMemoryTools(() => fixture.context, { lockWaitTimeoutMs: 50, lockRetryDelayMs: 10 })

    try {
      // when
      const result = await memoryTool.execute("call-1", {
        command: "create",
        reason: "Blocked write",
        file_path: "blocked.md",
        description: "d",
      })

      // then
      expect(result.isError).toBe(true)
      expect(textOf(result)).toContain("memory-write.lock")
    } finally {
      await releaseLock(lockPath, holder)
    }
  })

  test("#given concurrent executions #when both commit #then they serialize through the writer lock", async () => {
    // given
    const fixture = await boundFixture()
    const [memoryTool] = createMemoryTools(() => fixture.context)

    // when
    const [first, second] = await Promise.all([
      memoryTool.execute("call-1", { command: "create", reason: "Track a", file_path: "a.md", description: "a" }),
      memoryTool.execute("call-2", { command: "create", reason: "Track b", file_path: "b.md", description: "b" }),
    ])

    // then
    expect(first.isError).toBeUndefined()
    expect(second.isError).toBeUndefined()
    const subjects = (await git(fixture.repo, ["log", "-2", "--format=%s"])).split("\n").sort()
    expect(subjects).toEqual(["Track a", "Track b"])
    expect(await git(fixture.repo, ["status", "--porcelain"])).toBe("")
  })
})
