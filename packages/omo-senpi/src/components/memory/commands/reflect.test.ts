import { afterEach, describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"

import { MemoryFakeExtensionAPI, memorySettings } from "../memory.test-support"
import { fakeCommandContext, fakeDeps, invoke, tempIdentity, TEST_IDENTITY } from "./commands.test-support"
import { registerReflectCommand } from "./reflect"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

async function harness(overrides: Parameters<typeof fakeDeps>[1] = {}) {
  const { root, identity } = await tempIdentity()
  tempDirs.push(root)
  const deps = fakeDeps(identity, overrides)
  const pi = new MemoryFakeExtensionAPI()
  registerReflectCommand(pi, deps)
  return { deps, pi, ctx: fakeCommandContext() }
}

describe("/reflect", () => {
  test("#given free-text focus #when invoked #then a manual request is reserved and reported with its run id", async () => {
    // given
    const { deps, pi, ctx } = await harness()

    // when
    const text = await invoke(pi, "reflect", "tighten commit rules", ctx)

    // then
    expect(deps.reflectionRequests).toHaveLength(1)
    expect(deps.reflectionRequests[0]?.focus).toBe("tighten commit rules")
    expect(deps.reflectionRequests[0]?.recentN).toBeUndefined()
    expect(text).toContain("reserved")
    expect(text).toContain("run-1")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("info")
  })

  test("#given --recent N #when invoked #then the journal filter carries the count", async () => {
    // given
    const { deps, pi, ctx } = await harness()

    // when
    await invoke(pi, "reflect", "--recent 5 keep it short", ctx)

    // then
    expect(deps.reflectionRequests[0]?.recentN).toBe(5)
    expect(deps.reflectionRequests[0]?.focus).toBe("keep it short")
  })

  test("#given --conversation with ids #when invoked #then the ids are split into the request", async () => {
    // given
    const { deps, pi, ctx } = await harness()

    // when
    await invoke(pi, "reflect", "--conversation sess-a,sess-b", ctx)

    // then
    expect(deps.reflectionRequests[0]?.conversationIds).toEqual(["sess-a", "sess-b"])
  })

  test("#given an active run #when the sink queues the request #then the pending disposition is reported", async () => {
    // given
    const { deps, pi, ctx } = await harness()
    deps.receipt = { disposition: "pending", runId: "run-7" }

    // when
    const text = await invoke(pi, "reflect", "", ctx)

    // then
    expect(text).toContain("queued")
    expect(text).toContain("run-7")
  })

  test("#given a non-numeric --recent #when invoked #then a usage error is returned and no request is made", async () => {
    // given
    const { deps, pi, ctx } = await harness()

    // when
    const text = await invoke(pi, "reflect", "--recent soon", ctx)

    // then
    expect(deps.reflectionRequests).toHaveLength(0)
    expect(text).toContain("--recent expects a positive integer")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("error")
  })

  test("#given no reflection sink #when invoked #then an actionable error is returned", async () => {
    // given
    const { pi, ctx } = await harness({ reflectionSink: undefined })

    // when
    const text = await invoke(pi, "reflect", "", ctx)

    // then
    expect(text).toContain("reflection is not available")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("error")
  })

  test("#given an unbound session #when invoked #then an actionable error is returned", async () => {
    // given
    const deps = fakeDeps(undefined)
    const pi = new MemoryFakeExtensionAPI()
    registerReflectCommand(pi, deps)
    const ctx = fakeCommandContext()

    // when
    const text = await invoke(pi, "reflect", "", ctx)

    // then
    expect(deps.reflectionRequests).toHaveLength(0)
    expect(text).toContain("not bound")
  })

  test("#given reflection.enabled false #when invoked #then an error is returned and no request is submitted", async () => {
    // given
    const { deps, pi, ctx } = await harness({
      loadSettings: () => ({
        settings: memorySettings({
          reflection: { enabled: false, trigger: { step_count: 25, on_compaction: true }, merge: "auto", category: "quick", timeout_minutes: 15, sandbox: "auto" },
        }),
        configPath: "/tmp/omo.jsonc",
      }),
    })

    // when
    const text = await invoke(pi, "reflect", "", ctx)

    // then
    expect(deps.reflectionRequests).toHaveLength(0)
    expect(ctx.ui.notifications.at(-1)?.level).toBe("error")
  })

  test("#given reflection enabled in base but disabled by per-agent override #when invoked #then an error is returned and no request is submitted", async () => {
    // given
    const { root, identity } = await tempIdentity()
    tempDirs.push(root)
    const deps = fakeDeps(identity, {
      loadSettings: () => ({
        settings: memorySettings({
          agents: { [TEST_IDENTITY]: { reflection: { enabled: false } } },
        }),
        configPath: "/tmp/omo.jsonc",
      }),
    })
    const pi = new MemoryFakeExtensionAPI()
    registerReflectCommand(pi, deps)
    const ctx = fakeCommandContext()

    // when
    const text = await invoke(pi, "reflect", "", ctx)

    // then
    expect(deps.reflectionRequests).toHaveLength(0)
    expect(ctx.ui.notifications.at(-1)?.level).toBe("error")
  })
})
