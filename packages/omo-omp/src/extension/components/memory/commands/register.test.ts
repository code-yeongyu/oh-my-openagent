import { afterEach, describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"

import { MemoryFakeExtensionAPI } from "../memory.test-support"
import { fakeCommandContext, fakeDeps, invoke, seededRepo, tempIdentity } from "./commands.test-support"
import { MEMORY_COMMAND_NAMES, registerMemoryCommands } from "./register"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("registerMemoryCommands", () => {
  test("#given a fresh extension api #when the suite registers #then exactly the documented commands appear", async () => {
    // given
    const { root, identity } = await tempIdentity()
    tempDirs.push(root)
    const pi = new MemoryFakeExtensionAPI()

    // when
    registerMemoryCommands(pi, fakeDeps(identity))

    // then
    expect(pi.commands.map((command) => command.name).sort()).toEqual([...MEMORY_COMMAND_NAMES].sort())
    expect(MEMORY_COMMAND_NAMES).toEqual([
      "memory",
      "memfs",
      "remember",
      "init",
      "doctor",
      "recompile",
      "memory-repository",
      "sleeptime",
      "reflect",
      "search",
    ])
  })

  test("#given the registered suite #when each registration is inspected #then description, argumentHint, and handler are present", async () => {
    // given
    const { root, identity } = await tempIdentity()
    tempDirs.push(root)
    const pi = new MemoryFakeExtensionAPI()

    // when
    registerMemoryCommands(pi, fakeDeps(identity))

    // then
    for (const command of pi.commands) {
      expect(typeof command.options.description).toBe("string")
      expect((command.options.description as string).length).toBeGreaterThan(0)
      expect(typeof command.options.argumentHint).toBe("string")
      expect(typeof command.options.handler).toBe("function")
    }
  })

  test("#given a bound identity with a repository #when a registered handler runs #then it renders through the shared seams", async () => {
    // given
    const { root, identity } = await tempIdentity()
    tempDirs.push(root)
    await seededRepo(identity, [
      { relativePath: "system/persona.md", content: "---\ndescription: Persona\n---\nbarrel wired\n" },
    ])
    const pi = new MemoryFakeExtensionAPI()
    registerMemoryCommands(pi, fakeDeps(identity))
    const ctx = fakeCommandContext()

    // when
    const text = await invoke(pi, "memory", "", ctx)

    // then
    expect(text).toContain("barrel wired")
    expect(ctx.ui.notifications.at(-1)?.message).toBe(text)
  })
})
