import { afterEach, describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"

import { MemoryFakeExtensionAPI } from "../memory.test-support"
import {
  fakeCommandContext,
  fakeDeps,
  invoke,
  tempIdentity,
  trackSendOrder,
} from "./commands.test-support"
import { registerRememberCommand } from "./remember"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

describe("/remember", () => {
  test("#given a bound identity #when invoked with text #then waitForIdle precedes a REMEMBER-style user turn", async () => {
    // given
    const { root, identity } = await tempIdentity()
    tempDirs.push(root)
    const pi = new MemoryFakeExtensionAPI()
    registerRememberCommand(pi, fakeDeps(identity))
    const ctx = fakeCommandContext()
    const order = trackSendOrder(pi, ctx)

    // when
    const text = await invoke(pi, "remember", "I prefer tabs over spaces", ctx)

    // then
    expect(order).toEqual(["waitForIdle", "sendUserMessage"])
    expect(pi.userMessages).toHaveLength(1)
    const content = pi.userMessages[0]?.content
    expect(typeof content).toBe("string")
    const message = content as string
    expect(message).toContain("Persist this as long-term memory if appropriate")
    expect(message).toContain("I prefer tabs over spaces")
    expect(text).toContain("memory request sent")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("info")
  })

  test("#given empty text #when invoked #then a usage error is returned and nothing is sent", async () => {
    // given
    const { root, identity } = await tempIdentity()
    tempDirs.push(root)
    const pi = new MemoryFakeExtensionAPI()
    registerRememberCommand(pi, fakeDeps(identity))
    const ctx = fakeCommandContext()

    // when
    const text = await invoke(pi, "remember", "   ", ctx)

    // then
    expect(text).toContain("usage: /remember <text>")
    expect(pi.userMessages).toHaveLength(0)
    expect(ctx.ui.notifications.at(-1)?.level).toBe("error")
  })

  test("#given an unbound session #when invoked #then an actionable error is returned and nothing is sent", async () => {
    // given
    const pi = new MemoryFakeExtensionAPI()
    registerRememberCommand(pi, fakeDeps(undefined))
    const ctx = fakeCommandContext()

    // when
    const text = await invoke(pi, "remember", "remember this", ctx)

    // then
    expect(text).toContain("not bound")
    expect(pi.userMessages).toHaveLength(0)
    expect(ctx.ui.notifications.at(-1)?.level).toBe("error")
  })
})
