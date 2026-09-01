import { afterEach, describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"

import { MemoryFakeExtensionAPI } from "../memory.test-support"
import { fakeCommandContext, fakeDeps, invoke, tempIdentity } from "./commands.test-support"
import { registerRecompileCommand } from "./recompile"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

describe("/recompile", () => {
  test("#given a bound identity #when invoked #then the prompt cache is busted for the next run", async () => {
    // given
    const { root, identity } = await tempIdentity()
    tempDirs.push(root)
    const deps = fakeDeps(identity)
    const pi = new MemoryFakeExtensionAPI()
    registerRecompileCommand(pi, deps)
    const ctx = fakeCommandContext()

    // when
    const text = await invoke(pi, "recompile", "", ctx)

    // then
    expect(deps.busts).toHaveLength(1)
    expect(text).toContain("next agent run")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("info")
  })

  test("#given an unbound session #when invoked #then nothing is busted and an error is returned", async () => {
    // given
    const deps = fakeDeps(undefined)
    const pi = new MemoryFakeExtensionAPI()
    registerRecompileCommand(pi, deps)
    const ctx = fakeCommandContext()

    // when
    const text = await invoke(pi, "recompile", "", ctx)

    // then
    expect(deps.busts).toHaveLength(0)
    expect(text).toContain("not bound")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("error")
  })
})
