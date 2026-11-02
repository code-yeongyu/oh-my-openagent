import { describe, expect, test } from "bun:test"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { readMemoryUsageLedger, memoryUsagePaths } from "./memory-usage-ledger"
import { MemoryUsageTracker } from "./memory-usage-tracker"
import { registerMemoryUsage } from "./memory-usage-wiring"
import { eventContext, fixture, toolCall } from "./memory-usage.test-support"

describe("registerMemoryUsage", () => {
  test("#given a read tool and context only on the callback context #when dispatched then flushed #then the memory ledger records the read", async () => {
    // #given
    const { context, repoDir } = await fixture()
    const pi = new FakeExtensionAPI()
    const sessionContext = eventContext("session-1")
    const trackers = registerMemoryUsage(pi, {
      resolveContext: (candidate) => candidate === sessionContext ? context : undefined,
      resolveCwd: () => repoDir,
      now: () => new Date("2026-01-15T10:00:00Z"),
    })

    // #when
    await pi.dispatch(
      "tool_call",
      toolCall("read", { path: join(repoDir, "reference", "project", "foo.md") }),
      sessionContext,
    )
    const tracker = trackers.get(context.identity)
    await tracker?.flush()

    // #then
    const ledger = await readMemoryUsageLedger(memoryUsagePaths(context.identityPaths).ledgerPath)
    expect(ledger["reference/project/foo.md"]).toEqual({ count: 1, lastUsedAt: "2026-01-15T10:00:00.000Z" })
  })

  test("#given a read tool targeting reference/project/foo.md #when dispatched then flushed #then foo.md.count is 1", async () => {
    const { context, repoDir } = await fixture()
    const pi = new FakeExtensionAPI()
    const trackers = registerMemoryUsage(pi, {
      resolveContext: () => context,
      resolveCwd: () => repoDir,
      now: () => new Date("2026-01-15T10:00:00Z"),
    })
    await pi.dispatch(
      "tool_call",
      toolCall("read", { path: join(repoDir, "reference", "project", "foo.md") }),
      eventContext("session-1"),
    )
    const tracker = trackers.get(context.identity)
    await tracker?.flush()
    const ledger = await readMemoryUsageLedger(memoryUsagePaths(context.identityPaths).ledgerPath)
    expect(ledger["reference/project/foo.md"]).toEqual({ count: 1, lastUsedAt: "2026-01-15T10:00:00.000Z" })
  })

  test("#given a read tool targeting system/persona.md #when dispatched then flushed #then ledger is empty (system excluded)", async () => {
    const { context, repoDir } = await fixture()
    const pi = new FakeExtensionAPI()
    const trackers = registerMemoryUsage(pi, {
      resolveContext: () => context,
      resolveCwd: () => repoDir,
      now: () => new Date("2026-01-15T10:00:00Z"),
    })
    await pi.dispatch(
      "tool_call",
      toolCall("read", { path: join(repoDir, "system", "persona.md") }),
      eventContext("session-1"),
    )
    const tracker = trackers.get(context.identity)
    await tracker?.flush()
    const ledger = await readMemoryUsageLedger(memoryUsagePaths(context.identityPaths).ledgerPath)
    expect(Object.keys(ledger)).toEqual([])
  })

  test("#given a read tool targeting .tmp/scratch.md #when dispatched then flushed #then ledger is empty (.tmp excluded)", async () => {
    const { context, repoDir } = await fixture()
    const pi = new FakeExtensionAPI()
    const trackers = registerMemoryUsage(pi, {
      resolveContext: () => context,
      resolveCwd: () => repoDir,
      now: () => new Date("2026-01-15T10:00:00Z"),
    })
    await pi.dispatch(
      "tool_call",
      toolCall("read", { path: join(repoDir, ".tmp", "scratch.md") }),
      eventContext("session-1"),
    )
    const tracker = trackers.get(context.identity)
    await tracker?.flush()
    const ledger = await readMemoryUsageLedger(memoryUsagePaths(context.identityPaths).ledgerPath)
    expect(Object.keys(ledger)).toEqual([])
  })

  test("#given a write tool targeting reference/project/foo.md #when dispatched then flushed #then ledger is empty (only read tools tracked)", async () => {
    const { context, repoDir } = await fixture()
    const pi = new FakeExtensionAPI()
    const trackers = registerMemoryUsage(pi, {
      resolveContext: () => context,
      resolveCwd: () => repoDir,
      now: () => new Date("2026-01-15T10:00:00Z"),
    })
    await pi.dispatch(
      "tool_call",
      toolCall("write", { path: join(repoDir, "reference", "project", "foo.md") }),
      eventContext("session-1"),
    )
    const tracker = trackers.get(context.identity)
    await tracker?.flush()
    const ledger = await readMemoryUsageLedger(memoryUsagePaths(context.identityPaths).ledgerPath)
    expect(Object.keys(ledger)).toEqual([])
  })

  test("#given a read tool targeting a path outside the repo #when dispatched then flushed #then ledger is empty", async () => {
    const { context, repoDir } = await fixture()
    const pi = new FakeExtensionAPI()
    const trackers = registerMemoryUsage(pi, {
      resolveContext: () => context,
      resolveCwd: () => repoDir,
      now: () => new Date("2026-01-15T10:00:00Z"),
    })
    await pi.dispatch(
      "tool_call",
      toolCall("read", { path: "/tmp/some-other-file.md" }),
      eventContext("session-1"),
    )
    const tracker = trackers.get(context.identity)
    await tracker?.flush()
    const ledger = await readMemoryUsageLedger(memoryUsagePaths(context.identityPaths).ledgerPath)
    expect(Object.keys(ledger)).toEqual([])
  })
})

describe("memory usage flush failures", () => {
  test("#given an unavailable ledger lock directory #when the tracked batch flushes #then the failure is logged without rejecting", async () => {
    const { paths, repoDir } = await fixture()
    const blocker = join(repoDir, "lock-parent")
    await writeFile(blocker, "not a directory")
    const warnings: string[] = []
    const tracker = new MemoryUsageTracker({
      paths: { ...paths, lockPath: join(blocker, "memory-usage.lock") },
      repoDir,
      logger: {
        debug: () => {}, info: () => {}, error: () => {},
        warn: (message) => { warnings.push(message) },
      },
    })
    tracker.recordRead(join(repoDir, "reference", "project", "foo.md"))
    await expect(tracker.flush()).resolves.toBeUndefined()
    expect(warnings).toEqual(["memory-usage ledger flush failed"])
  })
})
