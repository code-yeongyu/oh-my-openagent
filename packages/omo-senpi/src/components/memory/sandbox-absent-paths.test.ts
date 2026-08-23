import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { rmSyncEfaultTolerant } from "./teardown.test-support"

import type { ReflectionSpawnArgs } from "./worker/spawn"
import { buildSandboxTransform, SandboxUnavailableError } from "./sandbox"

// Regression coverage for the reflection `spawn_failed` bug: the reflection runtime dirs
// (runtime/reflection, runtime/reflection-sessions, the resolved agent dir, XDG_CONFIG_HOME)
// are handed to the sandbox builder before anything creates them, so canonicalizing a
// not-yet-existing entry with a bare realpathSync threw a raw
// `ENOENT ... lstat '<first missing ancestor>'` PRE-spawn and the reflection cursor never advanced.

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSyncEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

function fixture(): { readonly root: string; readonly worktree: string; readonly gitCommonDir: string; readonly payload: string } {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "omo-sandbox-absent-")))
  roots.push(root)
  const worktree = join(root, "parent", "runtime", "worktree")
  const gitCommonDir = join(root, "parent", ".git")
  const payload = join(root, "payload", "transcript.json")
  for (const dir of [worktree, gitCommonDir, dirname(payload)]) mkdirSync(dir, { recursive: true })
  writeFileSync(payload, "payload")
  return { root, worktree, gitCommonDir, payload }
}

function spawnArgs(worktree: string): ReflectionSpawnArgs {
  const sessionDir = dirname(worktree)
  return {
    attempt: 1,
    hardDeadlineAt: Date.now() + 10_000,
    category: "quick",
    conversationIds: ["conversation-a"],
    model: "fixture/model",
    command: "/bin/sh",
    args: ["-c", "exit 0"],
    cwd: worktree,
    env: { PATH: process.env.PATH },
    detached: true,
    paths: {
      sessionDir,
      worktree,
      gitCommonDir: join(sessionDir, ".git"),
      transcript: join(sessionDir, "transcript.json"),
      persona: join(sessionDir, "persona.md"),
      prompt: join(sessionDir, "prompt.md"),
    },
  }
}

const darwin = { platform: "darwin" as const, which: () => "/usr/bin/sandbox-exec" }

describe("reflection sandbox with not-yet-created paths", () => {
  test("#given a runtime write dir that does not exist yet #when the Darwin transform is built #then no ENOENT is thrown and the profile grants that exact path", () => {
    // given
    const setup = fixture()
    const absentRuntimeWrite = join(setup.root, "runtime", "reflection-sessions")

    // when
    const transform = buildSandboxTransform({
      policy: "auto",
      worktreeDir: setup.worktree,
      gitCommonDir: setup.gitCommonDir,
      payloadPaths: [setup.payload],
      runtimeWrites: [absentRuntimeWrite],
      command: "/bin/sh",
      env: { PATH: process.env.PATH },
      ...darwin,
    })
    const profile = transform(spawnArgs(setup.worktree)).args[1]

    // then
    expect(transform.wasSandboxed).toBe(true)
    expect(profile).toContain(`(allow file-write* (subpath ${JSON.stringify(absentRuntimeWrite)}))`)
    // The grant must be the full intended path, never a truncated existing ancestor: granting
    // write on the tmp root (or worse, /Users) would widen the sandbox instead of fixing it.
    expect(profile).not.toContain(`(allow file-write* (subpath ${JSON.stringify(setup.root)}))`)
    expect(profile).not.toContain(`(allow file-write* (subpath ${JSON.stringify(dirname(absentRuntimeWrite))}))`)
  }, 30_000)

  test("#given absent payload and foreign-root entries #when the Darwin transform is built #then the rendered rules name the full intended paths", () => {
    // given
    const setup = fixture()
    const absentPayload = join(setup.root, "payload", "not-written-yet.json")
    const absentForeignRoot = join(setup.root, "agents", "other-agent")

    // when
    const transform = buildSandboxTransform({
      policy: "auto",
      worktreeDir: setup.worktree,
      gitCommonDir: setup.gitCommonDir,
      payloadPaths: [absentPayload],
      foreignRoots: [absentForeignRoot],
      command: "/bin/sh",
      env: { PATH: process.env.PATH },
      ...darwin,
    })
    const profile = transform(spawnArgs(setup.worktree)).args[1]

    // then
    expect(profile).toContain(`(allow file-read* (literal ${JSON.stringify(absentPayload)}))`)
    expect(profile).toContain(`(deny file-read* (subpath ${JSON.stringify(absentForeignRoot)}))`)
    // A foreign-agent deny that collapsed to an existing ancestor would silently stop protecting
    // the sibling agent's memory, so assert the ancestor is never the denied subpath.
    expect(profile).not.toContain(`(deny file-read* (subpath ${JSON.stringify(dirname(absentForeignRoot))}))`)
  }, 30_000)

  test("#given a Linux runtime write dir that does not exist yet #when the bwrap transform is built #then that exact path is rebound writable", () => {
    // given
    const setup = fixture()
    const absentRuntimeWrite = join(setup.root, "runtime", "reflection")

    // when
    const transform = buildSandboxTransform({
      policy: "auto",
      worktreeDir: setup.worktree,
      gitCommonDir: setup.gitCommonDir,
      payloadPaths: [setup.payload],
      runtimeWrites: [absentRuntimeWrite],
      command: "/bin/sh",
      env: { PATH: process.env.PATH },
      platform: "linux",
      which: () => "/usr/bin/bwrap",
    })
    const args = transform(spawnArgs(setup.worktree)).args

    // then
    expect(transform.wasSandboxed).toBe(true)
    expect(args).toContain(absentRuntimeWrite)
    expect(args).not.toContain(setup.root)
  }, 30_000)

  test("#given required policy and an absent runtime write dir #when the transform is built #then it still succeeds rather than failing closed on a raw ENOENT", () => {
    // given
    const setup = fixture()
    const absentRuntimeWrite = join(setup.root, "runtime", "reflection")

    // when
    const build = () => buildSandboxTransform({
      policy: "required",
      worktreeDir: setup.worktree,
      gitCommonDir: setup.gitCommonDir,
      payloadPaths: [setup.payload],
      runtimeWrites: [absentRuntimeWrite],
      command: "/bin/sh",
      env: { PATH: process.env.PATH },
      ...darwin,
    })

    // then
    expect(build).not.toThrow()
    expect(build().wasSandboxed).toBe(true)
    expect(build).not.toThrow(SandboxUnavailableError)
  }, 30_000)
})
