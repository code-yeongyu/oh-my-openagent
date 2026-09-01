import { afterEach, describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"

import { GitMemoryRepo, installHooks } from "@oh-my-opencode/memory-core"

import { MemoryFakeExtensionAPI } from "../memory.test-support"
import {
  fakeCommandContext,
  fakeDeps,
  invoke,
  seededRepo,
  tempIdentity,
  trackSendOrder,
} from "./commands.test-support"
import { registerInitCommand } from "./init"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

describe("/init", () => {
  test("#given no repository #when invoked #then the repo is initialized and a standardized instruction turn follows waitForIdle", async () => {
    // given
    const { root, identity } = await tempIdentity()
    tempDirs.push(root)
    const pi = new MemoryFakeExtensionAPI()
    registerInitCommand(pi, fakeDeps(identity))
    const ctx = fakeCommandContext()
    const order = trackSendOrder(pi, ctx)

    // when
    const text = await invoke(pi, "init", "", ctx)

    // then
    const repo = new GitMemoryRepo({
      dir: identity.identityPaths.repo,
      agentId: identity.identity,
      installHooks: (dir: string) => {
        installHooks(dir)
      },
    })
    expect(await repo.head()).not.toBeNull()
    expect(order).toEqual(["waitForIdle", "sendUserMessage"])
    expect(pi.userMessages).toHaveLength(1)
    const message = pi.userMessages[0]?.content as string
    expect(message).toContain("[MEMORY INITIALIZATION]")
    expect(message).toContain("system/persona.md")
    expect(message).toContain("description:")
    expect(text).toContain("initialized")
  }, 30_000)

  test("#given an existing repository #when invoked #then it refuses without overwriting and sends nothing", async () => {
    // given
    const { root, identity } = await tempIdentity()
    tempDirs.push(root)
    const repo = await seededRepo(identity, [
      { relativePath: "system/persona.md", content: "---\ndescription: persona\n---\nkeep me\n" },
    ])
    const headBefore = await repo.head()
    const pi = new MemoryFakeExtensionAPI()
    registerInitCommand(pi, fakeDeps(identity))
    const ctx = fakeCommandContext()

    // when
    const text = await invoke(pi, "init", "", ctx)

    // then
    expect(text).toContain("already initialized")
    expect(await repo.head()).toBe(headBefore)
    expect(await repo.show("HEAD", "system/persona.md")).toContain("keep me")
    expect(pi.userMessages).toHaveLength(0)
    expect(ctx.ui.notifications.at(-1)?.level).toBe("error")
  }, 30_000)

  test("#given an unbound session #when invoked #then an actionable error is returned", async () => {
    // given
    const pi = new MemoryFakeExtensionAPI()
    registerInitCommand(pi, fakeDeps(undefined))
    const ctx = fakeCommandContext()

    // when
    const text = await invoke(pi, "init", "", ctx)

    // then
    expect(text).toContain("not bound")
    expect(pi.userMessages).toHaveLength(0)
  }, 30_000)
})
