import { afterEach, describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"

import { MemoryFakeExtensionAPI, memorySettings } from "../memory.test-support"
import { TEST_IDENTITY, fakeCommandContext, fakeDeps, invoke, tempIdentity } from "./commands.test-support"
import { registerSleeptimeCommand } from "./sleeptime"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("/sleeptime", () => {
  test("#given default settings #when invoked #then resolved reflection settings, the config path, and the reflect hint render", async () => {
    // given
    const { root, identity } = await tempIdentity()
    tempDirs.push(root)
    const pi = new MemoryFakeExtensionAPI()
    registerSleeptimeCommand(pi, fakeDeps(identity))
    const ctx = fakeCommandContext()

    // when
    const text = await invoke(pi, "sleeptime", "", ctx)

    // then
    expect(text).toContain("Step trigger: off")
    expect(text).toContain("On compaction: on")
    expect(text).toContain("Merge policy: auto")
    expect(text).toContain("Category: quick")
    expect(text).toContain("Timeout: 15 minutes")
    expect(text).toContain("Sandbox: auto")
    expect(text).toContain("/tmp/omo.jsonc")
    expect(text).toContain("memory.reflection")
    expect(text).toContain("/reflect")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("info")
  })

  test("#given a per-agent override #when invoked #then overridden fields are marked and applied", async () => {
    // given
    const { root, identity } = await tempIdentity()
    tempDirs.push(root)
    const settings = memorySettings({
      agents: {
        [TEST_IDENTITY]: {
          reflection: { trigger: { step_count: 5 }, merge: "integration", timeout_minutes: 30 },
        },
      },
    })
    const pi = new MemoryFakeExtensionAPI()
    registerSleeptimeCommand(pi, fakeDeps(identity, { loadSettings: () => ({ settings, configPath: "/tmp/omo.jsonc" }) }))
    const ctx = fakeCommandContext()

    // when
    const text = await invoke(pi, "sleeptime", "", ctx)

    // then
    expect(text).toContain("Step trigger: every 5 steps [agent override]")
    expect(text).toContain("Merge policy: integration [agent override]")
    expect(text).toContain("Timeout: 30 minutes [agent override]")
    expect(text).toContain("Category: quick")
    expect(text).toContain(`memory.agents.${TEST_IDENTITY}.reflection`)
  })

  test("#given an unbound session #when invoked #then an actionable error is returned", async () => {
    // given
    const pi = new MemoryFakeExtensionAPI()
    registerSleeptimeCommand(pi, fakeDeps(undefined))
    const ctx = fakeCommandContext()

    // when
    const text = await invoke(pi, "sleeptime", "", ctx)

    // then
    expect(text).toContain("not bound")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("error")
  })
})
