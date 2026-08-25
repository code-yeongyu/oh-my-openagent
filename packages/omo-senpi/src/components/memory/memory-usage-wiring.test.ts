import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { readMemoryUsageLedger, memoryUsagePaths } from "./memory-usage-ledger"
import { registerMemoryUsage } from "./memory-usage-wiring"
import { eventContext, fixture, toolCall } from "./memory-usage.test-support"

describe("registerMemoryUsage", () => {
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
