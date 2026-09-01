import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { readSkillsUsageLedger, skillsUsagePaths } from "./skills-usage-ledger"
import { registerSkillsUsage } from "./skills-usage-wiring"
import { eventContext, fixture, toolCall } from "./skills-usage.test-support"

describe("registerSkillsUsage", () => {
  test("#given a read tool targeting skills/foo/SKILL.md #when dispatched then flushed #then foo.count is 1", async () => {
    // #given
    const { context, repoDir } = await fixture()
    const pi = new FakeExtensionAPI()
    const trackers = registerSkillsUsage(pi, {
      resolveContext: () => context,
      resolveCwd: () => repoDir,
      now: () => new Date("2026-01-15T10:00:00Z"),
    })

    // #when
    await pi.dispatch(
      "tool_call",
      toolCall("read", { path: join(repoDir, "skills", "foo", "SKILL.md") }),
      eventContext("session-1"),
    )
    const tracker = trackers.get(context.identity)
    await tracker?.flush()

    // #then
    const ledger = await readSkillsUsageLedger(skillsUsagePaths(context.identityPaths).ledgerPath)
    expect(ledger.foo).toEqual({ count: 1, lastUsedAt: "2026-01-15T10:00:00.000Z" })
  })

  test("#given a read tool targeting notes/facts.md #when dispatched then flushed #then ledger is empty", async () => {
    // #given
    const { context, repoDir } = await fixture()
    const pi = new FakeExtensionAPI()
    const trackers = registerSkillsUsage(pi, {
      resolveContext: () => context,
      resolveCwd: () => repoDir,
      now: () => new Date("2026-01-15T10:00:00Z"),
    })

    // #when
    await pi.dispatch(
      "tool_call",
      toolCall("read", { path: join(repoDir, "notes", "facts.md") }),
      eventContext("session-1"),
    )
    const tracker = trackers.get(context.identity)
    await tracker?.flush()

    // #then
    const ledger = await readSkillsUsageLedger(skillsUsagePaths(context.identityPaths).ledgerPath)
    expect(Object.keys(ledger)).toEqual([])
  })

  test("#given a write tool targeting skills/foo/SKILL.md #when dispatched then flushed #then ledger is empty (only read tools tracked)", async () => {
    // #given
    const { context, repoDir } = await fixture()
    const pi = new FakeExtensionAPI()
    const trackers = registerSkillsUsage(pi, {
      resolveContext: () => context,
      resolveCwd: () => repoDir,
      now: () => new Date("2026-01-15T10:00:00Z"),
    })

    // #when
    await pi.dispatch(
      "tool_call",
      toolCall("write", { path: join(repoDir, "skills", "foo", "SKILL.md"), content: "new" }),
      eventContext("session-1"),
    )
    const tracker = trackers.get(context.identity)
    await tracker?.flush()

    // #then
    const ledger = await readSkillsUsageLedger(skillsUsagePaths(context.identityPaths).ledgerPath)
    expect(Object.keys(ledger)).toEqual([])
  })

  test("#given an unbound session #when dispatched #then no tracker is created", async () => {
    // #given
    const pi = new FakeExtensionAPI()
    const trackers = registerSkillsUsage(pi, {
      resolveContext: () => undefined,
      resolveCwd: () => "/tmp",
    })

    // #when
    await pi.dispatch(
      "tool_call",
      toolCall("read", { path: "/tmp/skills/foo/SKILL.md" }),
      eventContext("session-1"),
    )

    // #then
    expect(trackers.size).toBe(0)
  })

  test("#given a pending increment and an aborted drain signal #when flushed #then the ledger is never written", async () => {
    // given
    const { context, repoDir } = await fixture()
    const pi = new FakeExtensionAPI()
    const trackers = registerSkillsUsage(pi, {
      resolveContext: () => context,
      resolveCwd: () => repoDir,
      now: () => new Date("2026-01-15T10:00:00Z"),
    })
    await pi.dispatch(
      "tool_call",
      toolCall("read", { path: join(repoDir, "skills", "foo", "SKILL.md") }),
      eventContext("session-1"),
    )
    const tracker = trackers.get(context.identity)
    const aborted = new AbortController()
    aborted.abort()

    // when
    await tracker?.flush(aborted.signal)

    // then
    const ledger = await readSkillsUsageLedger(skillsUsagePaths(context.identityPaths).ledgerPath)
    expect(Object.keys(ledger)).toHaveLength(0)
  })
})
