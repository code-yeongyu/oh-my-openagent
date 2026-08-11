import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { MemoryFakeExtensionAPI } from "../memory.test-support"
import {
  fakeCommandContext,
  fakeDeps,
  invoke,
  seededRepo,
  tempIdentity,
} from "./commands.test-support"
import { registerMemoryCommand } from "./memory"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const SEEDS = [
  { relativePath: "system/persona.md", content: "---\ndescription: Persona\n---\nI am the test persona.\n" },
  { relativePath: "system/projects/index.md", content: "---\ndescription: Project index\n---\nSee [[external/notes]].\n" },
  { relativePath: "external/notes.md", content: "scratch notes\n" },
  { relativePath: "skills/commit/SKILL.md", content: "---\nname: commit\ndescription: Commit helper\n---\n" },
]

describe("/memory", () => {
  test("#given a clean committed repo #when invoked #then the viewer lists HEAD, system bodies, and external names", async () => {
    // given
    const { root, identity } = await tempIdentity()
    tempDirs.push(root)
    const repo = await seededRepo(identity, SEEDS)
    const head = await repo.head()
    const pi = new MemoryFakeExtensionAPI()
    registerMemoryCommand(pi, fakeDeps(identity))
    const ctx = fakeCommandContext()

    // when
    const text = await invoke(pi, "memory", "", ctx)

    // then
    expect(text).toContain(`HEAD: ${(head ?? "").slice(0, 8)}`)
    expect(text).toContain("clean")
    expect(text).toContain("### system/persona.md — Persona")
    expect(text).toContain("I am the test persona.")
    expect(text).toContain("### system/projects/index.md — Project index")
    expect(text).toContain("- external/notes.md")
    expect(text).toContain("- skills/commit/SKILL.md")
    expect(text).not.toContain("Uncommitted")
    expect(ctx.ui.notifications.at(-1)?.message).toBe(text)
    expect(ctx.ui.notifications.at(-1)?.level).toBe("info")
  })

  test("#given a dirty working tree #when invoked #then uncommitted changes render in a separate section", async () => {
    // given
    const { root, identity } = await tempIdentity()
    tempDirs.push(root)
    await seededRepo(identity, SEEDS)
    await writeFile(join(identity.identityPaths.repo, "system", "persona.md"), "---\ndescription: Persona\n---\nchanged\n")
    await writeFile(join(identity.identityPaths.repo, "external", "fresh.md"), "untracked\n")

    const pi = new MemoryFakeExtensionAPI()
    registerMemoryCommand(pi, fakeDeps(identity))
    const ctx = fakeCommandContext()

    // when
    const text = await invoke(pi, "memory", "", ctx)

    // then
    expect(text).toContain("dirty")
    expect(text).toContain("## Uncommitted changes")
    expect(text).toContain("M system/persona.md")
    expect(text).toContain("?? external/fresh.md")
    // committed view still shows the HEAD body, not the dirty one
    expect(text).toContain("I am the test persona.")
    expect(text).not.toContain("changed\n")
  })

  test("#given no repository #when invoked #then an actionable error is returned", async () => {
    // given
    const { root, identity } = await tempIdentity()
    tempDirs.push(root)
    const pi = new MemoryFakeExtensionAPI()
    registerMemoryCommand(pi, fakeDeps(identity))
    const ctx = fakeCommandContext()

    // when
    const text = await invoke(pi, "memory", "", ctx)

    // then
    expect(text).toContain("no memory repository")
    expect(text).toContain("/memfs init")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("error")
  })

  test("#given an unbound session #when invoked #then an actionable error is returned", async () => {
    // given
    const pi = new MemoryFakeExtensionAPI()
    registerMemoryCommand(pi, fakeDeps(undefined))
    const ctx = fakeCommandContext()

    // when
    const text = await invoke(pi, "memory", "", ctx)

    // then
    expect(text).toContain("not bound")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("error")
  })
})
