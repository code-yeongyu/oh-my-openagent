import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { hostname } from "node:os"
import { join } from "node:path"

import { memoryWriterLockPath } from "@oh-my-opencode/memory-core"

import { MemoryFakeExtensionAPI, memorySettings } from "../memory.test-support"
import {
  fakeCommandContext,
  fakeDeps,
  invoke,
  seededRepo,
  tempIdentity,
  type FakeDeps,
} from "./commands.test-support"
import { registerDoctorCommand } from "./doctor"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const SEEDS = [
  { relativePath: "system/persona.md", content: "---\ndescription: Persona\n---\nseeded persona\n" },
]

async function harness(options: { readonly seeded?: boolean; readonly deps?: Partial<FakeDeps> } = {}) {
  const { root, identity } = await tempIdentity()
  tempDirs.push(root)
  if (options.seeded !== false) await seededRepo(identity, SEEDS)
  const deps = fakeDeps(identity, options.deps)
  const pi = new MemoryFakeExtensionAPI()
  registerDoctorCommand(pi, deps)
  return { root, identity, deps, pi, ctx: fakeCommandContext() }
}

async function writeLock(locksDir: string, pid: number): Promise<string> {
  await mkdir(locksDir, { recursive: true })
  const path = memoryWriterLockPath(locksDir)
  await writeFile(
    path,
    `${JSON.stringify({
      pid,
      process_start: "start-token",
      hostname: hostname(),
      nonce: "nonce-1",
      created_at: new Date().toISOString(),
      purpose: "memory-write",
    })}\n`,
  )
  return path
}

describe("/doctor", () => {
  test("#given a healthy repository #when doctor runs #then every deterministic check passes", async () => {
    // given
    const { pi, ctx } = await harness()

    // when
    const text = await invoke(pi, "doctor", "", ctx)

    // then
    expect(text).toContain("[ok] repository")
    expect(text).toContain("[ok] frontmatter")
    expect(text).toContain("[ok] locks")
    expect(text).toContain("[ok] worktrees")
    expect(text).toContain("[ok] tokens")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("info")
  })

  test("#given no repository #when doctor runs #then the repository check fails with an actionable hint", async () => {
    // given
    const { pi, ctx } = await harness({ seeded: false })

    // when
    const text = await invoke(pi, "doctor", "", ctx)

    // then
    expect(text).toContain("[fail] repository")
    expect(text).toContain("/memfs init")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("error")
  })

  test("#given a memory file with invalid frontmatter #when doctor runs #then the sweep fails and names the file", async () => {
    // given
    const { identity, pi, ctx } = await harness()
    await writeFile(join(identity.identityPaths.repo, "system", "broken.md"), "no frontmatter here\n")

    // when
    const text = await invoke(pi, "doctor", "", ctx)

    // then
    expect(text).toContain("[fail] frontmatter")
    expect(text).toContain("system/broken.md")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("error")
  })

  test("#given a missing persona file #when doctor runs #then a persona warning is reported", async () => {
    // given
    const { root, identity } = await tempIdentity()
    tempDirs.push(root)
    await seededRepo(identity, [{ relativePath: "external/notes.md", content: "notes\n" }])
    const pi = new MemoryFakeExtensionAPI()
    registerDoctorCommand(pi, fakeDeps(identity))
    const ctx = fakeCommandContext()

    // when
    const text = await invoke(pi, "doctor", "", ctx)

    // then
    expect(text).toContain("[warn] persona")
    expect(text).toContain("system/persona.md")
  })

  test("#given a lock owned by a dead pid #when doctor runs #then the stale lock is reported with its path", async () => {
    // given
    const { identity, pi, ctx } = await harness()
    const lockPath = await writeLock(identity.identityPaths.locks, 987_654)

    // when
    const text = await invoke(pi, "doctor", "", ctx)

    // then
    expect(text).toContain("[warn] locks")
    expect(text).toContain(lockPath)
    expect(text).toContain("987654")
  })

  test("#given a lock owned by a live pid #when doctor runs #then no stale lock is reported", async () => {
    // given
    const { identity, deps, pi, ctx } = await harness()
    await writeLock(identity.identityPaths.locks, 4242)
    deps.alivePids.add(4242)

    // when
    const text = await invoke(pi, "doctor", "", ctx)

    // then
    expect(text).toContain("[ok] locks")
  })

  test("#given an unregistered worktree directory #when doctor runs #then the orphan is reported", async () => {
    // given
    const { identity, pi, ctx } = await harness()
    await mkdir(join(identity.identityPaths.worktrees, "orphan-run"), { recursive: true })

    // when
    const text = await invoke(pi, "doctor", "", ctx)

    // then
    expect(text).toContain("[warn] worktrees")
    expect(text).toContain("orphan-run")
  })

  test("#given a system estimate over the warn threshold #when doctor runs #then a token advisory is reported", async () => {
    // given
    const { pi, ctx } = await harness({
      deps: { loadSettings: () => ({ settings: memorySettings({ compile_warn_tokens: 1 }), configPath: "/tmp/omo.jsonc" }) },
    })

    // when
    const text = await invoke(pi, "doctor", "", ctx)

    // then
    expect(text).toContain("[warn] tokens")
    expect(text).toContain("1")
  })

  test("#given a skill missing name frontmatter #when doctor runs #then the repair helper reports the fix", async () => {
    // given
    const { identity, pi, ctx } = await harness()
    await mkdir(join(identity.identityPaths.repo, "skills", "commit"), { recursive: true })
    await writeFile(join(identity.identityPaths.repo, "skills", "commit", "SKILL.md"), "---\ndescription: x\n---\n")

    // when
    const text = await invoke(pi, "doctor", "", ctx)

    // then
    expect(text).toContain("skills/commit/SKILL.md")
    expect(text).toContain("name:")
  })

  test("#given an unbound session #when doctor runs #then an actionable error is returned", async () => {
    // given
    const pi = new MemoryFakeExtensionAPI()
    registerDoctorCommand(pi, fakeDeps(undefined))
    const ctx = fakeCommandContext()

    // when
    const text = await invoke(pi, "doctor", "", ctx)

    // then
    expect(text).toContain("not bound")
    expect(ctx.ui.notifications.at(-1)?.level).toBe("error")
  })
})
