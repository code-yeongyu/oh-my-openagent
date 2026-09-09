import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, statSync, writeFileSync } from "node:fs"
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
const linuxAvailable = {
  platform: "linux" as const,
  which: () => "/usr/bin/bwrap",
  probe: () => ({ usable: true as const }),
}

function hasExactBind(args: readonly string[], path: string): boolean {
  for (let i = 0; i < args.length - 2; i++) {
    if (args[i] === "--bind" && args[i + 1] === path && args[i + 2] === path) return true
  }
  return false
}

function assertPrivateDirectory(path: string): void {
  expect(existsSync(path)).toBe(true)
  expect(statSync(path).isDirectory()).toBe(true)
  if (process.platform !== "win32") {
    expect(statSync(path).mode & 0o777).toBe(0o700)
  }
}

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

  test("#given a Linux runtime write dir that does not exist yet #when the bwrap transform is built #then the directory exists with private permissions and the exact path is bound",
    () => {
      // given
      const setup = fixture()
      const absentRuntimeWrite = join(setup.root, "runtime", "reflection-sessions")
      expect(existsSync(absentRuntimeWrite)).toBe(false)

      // when
      const transform = buildSandboxTransform({
        policy: "auto",
        worktreeDir: setup.worktree,
        gitCommonDir: setup.gitCommonDir,
        payloadPaths: [setup.payload],
        runtimeWrites: [absentRuntimeWrite],
        command: "/bin/sh",
        env: { PATH: process.env.PATH },
        ...linuxAvailable,
      })
      const args = transform(spawnArgs(setup.worktree)).args

      // then: bwrap --bind requires a real source; creating the declared path (0700) is the
      // fix, not widening the grant to an existing ancestor or masking with --bind-try.
      expect(transform.wasSandboxed).toBe(true)
      assertPrivateDirectory(absentRuntimeWrite)
      expect(hasExactBind(args, absentRuntimeWrite)).toBe(true)
      expect(hasExactBind(args, setup.root)).toBe(false)
      expect(hasExactBind(args, dirname(absentRuntimeWrite))).toBe(false)
      expect(args).not.toContain("--bind-try")
    }, 30_000)

  test("#given a nested Linux writable path whose ancestors are also missing #when the bwrap transform is built #then the full leaf exists privately and is the bind source",
    () => {
      // given
      const setup = fixture()
      const absentNested = join(setup.root, "runtime", "reflection", "runs", "reflection-run-9")
      expect(existsSync(dirname(dirname(absentNested)))).toBe(false)

      // when
      const transform = buildSandboxTransform({
        policy: "required",
        worktreeDir: setup.worktree,
        gitCommonDir: setup.gitCommonDir,
        payloadPaths: [setup.payload],
        runtimeWrites: [absentNested],
        command: "/bin/sh",
        env: { PATH: process.env.PATH },
        ...linuxAvailable,
      })
      const args = transform(spawnArgs(setup.worktree)).args

      // then
      expect(transform.wasSandboxed).toBe(true)
      assertPrivateDirectory(absentNested)
      expect(hasExactBind(args, absentNested)).toBe(true)
      expect(hasExactBind(args, dirname(absentNested))).toBe(false)
      expect(hasExactBind(args, join(setup.root, "runtime"))).toBe(false)
    }, 30_000)

  test("#given an absent writable dir #when Linux policy is off or the sandbox is unavailable #then the path is not created",
    () => {
      // given
      const setup = fixture()
      const absentOff = join(setup.root, "runtime", "off-sessions")
      const absentMissing = join(setup.root, "runtime", "missing-bwrap")
      const absentUnusable = join(setup.root, "runtime", "unusable-bwrap")

      // when
      buildSandboxTransform({
        policy: "off",
        worktreeDir: setup.worktree,
        gitCommonDir: setup.gitCommonDir,
        payloadPaths: [setup.payload],
        runtimeWrites: [absentOff],
        command: "/bin/sh",
        env: { PATH: process.env.PATH },
        platform: "linux",
        which: () => { throw new Error("must not detect") },
        probe: () => { throw new Error("must not probe") },
      })
      buildSandboxTransform({
        policy: "auto",
        worktreeDir: setup.worktree,
        gitCommonDir: setup.gitCommonDir,
        payloadPaths: [setup.payload],
        runtimeWrites: [absentMissing],
        command: "/bin/sh",
        env: { PATH: process.env.PATH },
        platform: "linux",
        which: () => undefined,
        probe: () => { throw new Error("must not probe an unresolved executable") },
      })
      buildSandboxTransform({
        policy: "auto",
        worktreeDir: setup.worktree,
        gitCommonDir: setup.gitCommonDir,
        payloadPaths: [setup.payload],
        runtimeWrites: [absentUnusable],
        command: "/bin/sh",
        env: { PATH: process.env.PATH },
        platform: "linux",
        which: () => "/usr/bin/bwrap",
        probe: () => ({ usable: false, reason: "smoke test exited 1: bwrap: setting up uid map: Permission denied" }),
      })

      // then
      expect(existsSync(absentOff)).toBe(false)
      expect(existsSync(absentMissing)).toBe(false)
      expect(existsSync(absentUnusable)).toBe(false)
    }, 30_000)

  test("#given a Darwin sandbox with an absent runtime write dir #when the transform is built #then the path stays absent",
    () => {
      // given: seatbelt grants a subpath without needing the directory to exist; Linux mkdir
      // must not leak onto this path.
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

      // then
      expect(transform.wasSandboxed).toBe(true)
      expect(existsSync(absentRuntimeWrite)).toBe(false)
    }, 30_000)
})
