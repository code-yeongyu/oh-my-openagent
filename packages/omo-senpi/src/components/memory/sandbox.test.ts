import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import type { ReflectionSpawnArgs } from "./worker/spawn"
import {
  buildSandboxTransform,
  SandboxUnavailableError,
  type SandboxPolicy,
} from "./sandbox"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(): {
  readonly root: string
  readonly parentRepo: string
  readonly worktree: string
  readonly gitCommonDir: string
  readonly payloadPaths: readonly string[]
} {
  const root = mkdtempSync(join(tmpdir(), "omo-memory-sandbox-"))
  roots.push(root)
  const parentRepo = join(root, "parent")
  const worktree = join(parentRepo, "runtime", "worktree")
  const gitCommonDir = join(parentRepo, ".git")
  const payloadDir = join(root, "payload")
  const payloadPaths = [join(payloadDir, "transcript.json"), join(payloadDir, "persona.md")]
  for (const dir of [worktree, gitCommonDir, payloadDir]) mkdirSync(dir, { recursive: true })
  for (const path of payloadPaths) writeFileSync(path, "payload")
  return { root, parentRepo, worktree, gitCommonDir, payloadPaths }
}

function spawnArgs(worktree: string): ReflectionSpawnArgs {
  const sessionDir = dirname(worktree)
  return {
    command: "/bin/sh",
    args: ["-c", "exit 0"],
    cwd: worktree,
    env: { PATH: process.env.PATH },
    detached: true,
    paths: {
      sessionDir,
      worktree,
      gitCommonDir: join(dirname(worktree), ".git"),
      transcript: join(sessionDir, "transcript.json"),
      persona: join(sessionDir, "persona.md"),
      prompt: join(sessionDir, "prompt.md"),
    },
  }
}

function build(policy: SandboxPolicy, options: {
  readonly platform?: NodeJS.Platform
  readonly which?: (command: string) => string | undefined
} = {}) {
  const setup = fixture()
  return {
    setup,
    transform: buildSandboxTransform({
      policy,
      worktreeDir: setup.worktree,
      gitCommonDir: setup.gitCommonDir,
      payloadPaths: setup.payloadPaths,
      platform: options.platform,
      which: options.which,
    }),
  }
}

describe("reflection worker OS sandbox", () => {
  test.skipIf(process.platform !== "darwin" || !existsSync("/usr/bin/sandbox-exec"))(
    "#given the real Darwin seatbelt #when a child writes inside the worktree and its parent repo #then only the worktree write succeeds",
    () => {
      // given
      const { setup, transform } = build("required", { platform: "darwin", which: () => "/usr/bin/sandbox-exec" })
      const allowed = join(setup.worktree, "allowed.txt")
      const denied = join(setup.parentRepo, "denied.txt")

      // when
      const allowedRun = transform({ ...spawnArgs(setup.worktree), args: ["-c", `echo allowed > '${allowed}'`] })
      const allowedResult = Bun.spawnSync([allowedRun.command, ...allowedRun.args], { cwd: allowedRun.cwd, env: allowedRun.env })
      const deniedRun = transform({ ...spawnArgs(setup.worktree), args: ["-c", `echo denied > '${denied}'`] })
      const deniedResult = Bun.spawnSync([deniedRun.command, ...deniedRun.args], { cwd: deniedRun.cwd, env: deniedRun.env })

      // then
      expect(allowedResult.exitCode).toBe(0)
      expect(existsSync(allowed)).toBe(true)
      expect(deniedResult.exitCode).not.toBe(0)
      expect(deniedResult.stderr.toString()).toMatch(/Operation not permitted|Sandbox/)
      expect(existsSync(denied)).toBe(false)
    },
  )

  test("#given Darwin payloads and a foreign agent root #when the profile is generated #then payload reads and network remain allowed while foreign reads are denied", () => {
    // given
    const setup = fixture()
    const foreignRoot = join(setup.root, "foreign-agent")
    mkdirSync(foreignRoot)
    const transform = buildSandboxTransform({
      policy: "required",
      worktreeDir: setup.worktree,
      gitCommonDir: setup.gitCommonDir,
      payloadPaths: setup.payloadPaths,
      foreignRoots: [foreignRoot],
      platform: "darwin",
      which: () => "/usr/bin/sandbox-exec",
    })

    // when
    const transformed = transform(spawnArgs(setup.worktree))
    const profile = transformed.args[1]

    // then
    expect(profile).toContain("(allow default)")
    expect(profile).toContain(`(allow file-read* (literal ${JSON.stringify(realpathSync(setup.payloadPaths[0] ?? ""))}))`)
    expect(profile).toContain(`(deny file-read* (subpath ${JSON.stringify(realpathSync(foreignRoot))}))`)
    expect(transformed.env.TMPDIR).toBe(join(realpathSync(dirname(setup.payloadPaths[0] ?? "")), ".sandbox-tmp"))
  })

  test("#given the Darwin profile #when git-shell children run inside it #then device nodes they stream through stay writable", () => {
    // given
    const setup = fixture()
    const transform = buildSandboxTransform({
      policy: "required",
      worktreeDir: setup.worktree,
      gitCommonDir: setup.gitCommonDir,
      payloadPaths: setup.payloadPaths,
      platform: "darwin",
      which: () => "/usr/bin/sandbox-exec",
    })

    // when
    const profile = transform(spawnArgs(setup.worktree)).args[1]

    // then
    // git opens /dev/null read-write for stream redirection and the shell touches /dev/tty; the
    // earlier (deny file-write*) blanket killed every `git commit` inside a reflection child.
    expect(profile).toContain('(allow file-write* (literal "/dev/null"))')
    expect(profile).toContain('(allow file-write* (literal "/dev/tty"))')
  })

  test("#given Linux with bwrap available #when spawn arguments are transformed #then the root is read-only while worktree and git state are rebound writable", () => {
    // given
    const { setup, transform } = build("required", { platform: "linux", which: () => "/usr/bin/bwrap" })

    // when
    const transformed = transform(spawnArgs(setup.worktree))

    // then
    expect(transform.wasSandboxed).toBe(true)
    expect(transformed.command).toBe("/usr/bin/bwrap")
    expect(transformed.args).toEqual([
      "--ro-bind", "/", "/",
      "--dev-bind", "/dev", "/dev",
      "--tmpfs", "/tmp",
      "--bind", realpathSync(setup.worktree), realpathSync(setup.worktree),
      "--bind", realpathSync(setup.gitCommonDir), realpathSync(setup.gitCommonDir),
      "--chdir", setup.worktree,
      "--", "/bin/sh", "-c", "exit 0",
    ])
  })

  test("#given required policy without a platform sandbox #when the transform is built #then a typed unavailable error is thrown", () => {
    // given
    const setup = fixture()

    // when
    const buildRequired = () => buildSandboxTransform({
      policy: "required",
      worktreeDir: setup.worktree,
      gitCommonDir: setup.gitCommonDir,
      payloadPaths: setup.payloadPaths,
      platform: "linux",
      which: () => undefined,
    })

    // then
    expect(buildRequired).toThrow(SandboxUnavailableError)
    expect(buildRequired).toThrow("required reflection sandbox unavailable on linux: bwrap not found")
  })

  test("#given auto policy without a platform sandbox #when spawn arguments are transformed #then they pass through with an explicit warning", () => {
    // given
    const { setup, transform } = build("auto", { platform: "linux", which: () => undefined })
    const original = spawnArgs(setup.worktree)

    // when
    const transformed = transform(original)

    // then
    expect(transformed).toBe(original)
    expect(transform.wasSandboxed).toBe(false)
    expect(transform.warning).toBe("reflection sandbox unavailable on linux: bwrap not found; running unsandboxed because policy is auto")
  })

  test("#given off policy #when the transform is built and used #then detection is skipped and spawn arguments pass through", () => {
    // given
    const { setup, transform } = build("off", { platform: "linux", which: () => { throw new Error("must not detect") } })
    const original = spawnArgs(setup.worktree)

    // when
    const transformed = transform(original)

    // then
    expect(transformed).toBe(original)
    expect(transform.wasSandboxed).toBe(false)
    expect(transform.warning).toBeUndefined()
  })
})
