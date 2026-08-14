import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"

import type { FactsSpawnArgs, ReflectionSpawnArgs } from "./worker/spawn"
import {
  buildFactsSandboxTransform,
  buildSandboxTransform,
  SandboxUnavailableError,
  type SandboxPolicy,
} from "./sandbox"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
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
      gitCommonDir: join(dirname(worktree), ".git"),
      transcript: join(sessionDir, "transcript.json"),
      persona: join(sessionDir, "persona.md"),
      prompt: join(sessionDir, "prompt.md"),
    },
  }
}

function factsSpawnArgs(runDir: string): FactsSpawnArgs {
  return {
    runId: "facts-run-1",
    attempt: 1,
    hardDeadlineAt: Date.now() + 10_000,
    model: "fixture/model",
    command: "/bin/sh",
    args: ["-c", "exit 0"],
    cwd: runDir,
    env: { PATH: process.env.PATH },
    detached: true,
    paths: {
      runDir,
      payload: join(runDir, "facts-payload.json"),
      extraction: join(runDir, "extraction.jsonl"),
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
      command: "/bin/sh",
      env: { PATH: process.env.PATH },
      platform: options.platform,
      which: options.which,
    }),
  }
}

describe("reflection worker OS sandbox writable grants", () => {
  test("#given absent structural and external grants #when the inner command is missing #then no grant is created before the unsandboxed fallback", () => {
    // given
    const setup = fixture()
    const worktree = join(setup.root, "absent-worktree")
    const gitCommonDir = join(setup.root, "absent-git-common")
    const externalDir = join(setup.root, "absent-external-config")
    const ownedDir = join(setup.root, "absent-owned-runtime")

    // when
    const transform = buildSandboxTransform({
      policy: "required",
      worktreeDir: worktree,
      gitCommonDir,
      payloadPaths: setup.payloadPaths,
      runtimeWrites: [ownedDir],
      externalWritableDirs: [externalDir],
      command: "missing-senpi",
      env: { PATH: "" },
      platform: "linux",
      which: () => "/usr/bin/bwrap",
    })

    // then
    expect(transform.wasSandboxed).toBe(false)
    expect([worktree, gitCommonDir, externalDir, ownedDir].map(existsSync)).toEqual([false, false, false, false])
  })

  test("#given absent structural grants #when sandbox canonicalization starts #then it fails without creating either grant", () => {
    // given
    const setup = fixture()
    const worktree = join(setup.root, "absent-worktree")
    const gitCommonDir = join(setup.root, "absent-git-common")

    // when
    const build = () => buildSandboxTransform({
      policy: "required",
      worktreeDir: worktree,
      gitCommonDir,
      payloadPaths: setup.payloadPaths,
      command: "/bin/sh",
      env: { PATH: process.env.PATH },
      platform: "linux",
      which: () => "/usr/bin/bwrap",
    })

    // then
    expect(build).toThrow()
    expect([worktree, gitCommonDir].map(existsSync)).toEqual([false, false])
  })

  test("#given an absent environment-supplied grant #when sandbox canonicalization starts #then it fails without creating the grant", () => {
    // given
    const setup = fixture()
    const externalDir = join(setup.root, "absent-external-config")

    // when
    const build = () => buildSandboxTransform({
      policy: "required",
      worktreeDir: setup.worktree,
      gitCommonDir: setup.gitCommonDir,
      payloadPaths: setup.payloadPaths,
      externalWritableDirs: [externalDir],
      command: "/bin/sh",
      env: { PATH: process.env.PATH },
      platform: "linux",
      which: () => "/usr/bin/bwrap",
    })

    // then
    expect(build).toThrow()
    expect(existsSync(externalDir)).toBe(false)
  })

  test("#given a granted runtime dir the layout added but no writer has created #when the sandbox is built #then it is created and granted instead of failing the spawn", () => {
    // given a grant that does not exist yet, as after a layout gains a new runtime subdir
    const setup = fixture()
    const absentGrant = join(setup.parentRepo, "runtime", "reflection-sessions")
    expect(existsSync(absentGrant)).toBe(false)

    // when
    const transform = buildSandboxTransform({
      policy: "required",
      worktreeDir: setup.worktree,
      gitCommonDir: setup.gitCommonDir,
      payloadPaths: setup.payloadPaths,
      runtimeWrites: [absentGrant],
      command: "/bin/sh",
      env: { PATH: process.env.PATH },
      platform: "darwin",
      which: () => "/usr/bin/sandbox-exec",
    })

    // then
    expect(existsSync(absentGrant)).toBe(true)
    const profile = transform(spawnArgs(setup.worktree)).args[1] ?? ""
    // The profile quotes each path through JSON.stringify, which escapes the separators of a Windows
    // path, so the grant is matched in that same encoding rather than as a raw path.
    expect(profile).toContain(JSON.stringify(realpathSync(absentGrant)))
  })
})

describe("reflection worker OS sandbox", () => {
  test.skipIf(process.platform === "win32")(
    "#given a symlink to a directory with a literal backslash component #when grants are canonicalized #then the legal path resolves to its symlink target",
    () => {
      // given
      const root = mkdtempSync(join(tmpdir(), "omo-memory-backslash-sandbox-"))
      roots.push(root)
      const target = join(root, "back\\slash")
      const worktree = join(target, "worktree")
      const gitCommonDir = join(target, ".git")
      const payload = join(target, "transcript.json")
      mkdirSync(worktree, { recursive: true })
      mkdirSync(gitCommonDir)
      writeFileSync(payload, "payload")
      const alias = join(root, "alias")
      symlinkSync(target, alias, "dir")

      // when
      const transform = buildSandboxTransform({
        policy: "required",
        worktreeDir: join(alias, "worktree"),
        gitCommonDir: join(alias, ".git"),
        payloadPaths: [join(alias, "transcript.json")],
        command: "/bin/sh",
        env: { PATH: process.env.PATH },
        platform: "linux",
        which: () => "/usr/bin/bwrap",
      })
      const transformed = transform(spawnArgs(join(alias, "worktree")))

      // then
      const grantArgs = transformed.args.slice(0, transformed.args.indexOf("--chdir"))
      expect(grantArgs).toContain(join(realpathSync(root), "back\\slash", "worktree"))
      expect(grantArgs).toContain(join(realpathSync(root), "back\\slash", ".git"))
      expect(grantArgs).not.toContain(join(alias, "worktree"))
    },
  )

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
      command: "/bin/sh",
      env: { PATH: process.env.PATH },
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
  }, 30_000)

  test("#given the Darwin profile #when git-shell children run inside it #then device nodes they stream through stay writable", () => {
    // given
    const setup = fixture()
    const transform = buildSandboxTransform({
      policy: "required",
      worktreeDir: setup.worktree,
      gitCommonDir: setup.gitCommonDir,
      payloadPaths: setup.payloadPaths,
      command: "/bin/sh",
      env: { PATH: process.env.PATH },
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
  }, 30_000)

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
  }, 30_000)

  test("#given a bare inner command available on the child PATH #when sandbox arguments are transformed #then the wrapper receives its absolute path", () => {
    // given
    const setup = fixture()
    const original = {
      ...spawnArgs(setup.worktree),
      command: basename(process.execPath),
      env: { PATH: dirname(process.execPath) },
    }
    const transform = buildSandboxTransform({
      policy: "required",
      worktreeDir: setup.worktree,
      gitCommonDir: setup.gitCommonDir,
      payloadPaths: setup.payloadPaths,
      command: original.command,
      env: original.env,
      platform: "linux",
      which: () => "/usr/bin/bwrap",
    })

    // when
    const transformed = transform(original)

    // then
    expect(transformed.command).toBe("/usr/bin/bwrap")
    expect(transformed.args.slice(-4)).toEqual(["--", process.execPath, "-c", "exit 0"])
  }, 30_000)

  test("#given a bare inner command missing from the child PATH #when sandbox arguments are transformed #then it degrades to identity with an explicit warning", () => {
    // given
    const setup = fixture()
    const original = { ...spawnArgs(setup.worktree), command: "missing-senpi", env: { PATH: "" } }
    const transform = buildSandboxTransform({
      policy: "required",
      worktreeDir: setup.worktree,
      gitCommonDir: setup.gitCommonDir,
      payloadPaths: setup.payloadPaths,
      command: original.command,
      env: original.env,
      platform: "linux",
      which: () => "/usr/bin/bwrap",
    })

    // when
    const wasSandboxedBeforeSpawn = transform.wasSandboxed
    const transformed = transform(original)

    // then
    expect(wasSandboxedBeforeSpawn).toBe(false)
    expect(transformed).toBe(original)
    expect(transform.wasSandboxed).toBe(false)
    expect(transform.warning).toContain('inner command "missing-senpi" is not absolute and could not be resolved')
  }, 30_000)

  test("#given required policy without a platform sandbox #when the transform is built #then a typed unavailable error is thrown", () => {
    // given
    const setup = fixture()

    // when
    const buildRequired = () => buildSandboxTransform({
      policy: "required",
      worktreeDir: setup.worktree,
      gitCommonDir: setup.gitCommonDir,
      payloadPaths: setup.payloadPaths,
      command: "/bin/sh",
      env: { PATH: process.env.PATH },
      platform: "linux",
      which: () => undefined,
    })

    // then
    expect(buildRequired).toThrow(SandboxUnavailableError)
    expect(buildRequired).toThrow("required reflection sandbox unavailable on linux: bwrap not found")
  }, 30_000)

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
  }, 30_000)

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
  }, 30_000)
})

describe("facts worker OS sandbox", () => {
  test("#given Linux with bwrap available #when facts spawn arguments are transformed #then only the run directory is rebound writable", async () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "omo-memory-facts-sandbox-"))
    roots.push(root)
    const runDir = join(root, "runtime", "facts", "runs", "run-1")
    mkdirSync(runDir, { recursive: true })
    writeFileSync(join(runDir, "facts-payload.json"), "{}")
    const transform = buildFactsSandboxTransform({
      policy: "required",
      platform: "linux",
      which: () => "/usr/bin/bwrap",
    })

    // when
    const transformed = await transform(factsSpawnArgs(runDir))

    // then
    expect(transformed.command).toBe("/usr/bin/bwrap")
    expect(transformed.args).toEqual([
      "--ro-bind", "/", "/",
      "--dev-bind", "/dev", "/dev",
      "--tmpfs", "/tmp",
      "--bind", realpathSync(runDir), realpathSync(runDir),
      "--chdir", runDir,
      "--", "/bin/sh", "-c", "exit 0",
    ])
  }, 30_000)

  test("#given a missing facts inner command #when the transform is built #then its warning names the facts surface", async () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "omo-memory-facts-sandbox-"))
    roots.push(root)
    const runDir = join(root, "runtime", "facts", "runs", "run-1")
    mkdirSync(runDir, { recursive: true })
    writeFileSync(join(runDir, "facts-payload.json"), "{}")
    let warning: string | undefined
    const transform = buildFactsSandboxTransform({
      policy: "required",
      platform: "linux",
      which: () => "/usr/bin/bwrap",
      onWarning: (value) => { warning = value },
    })

    // when
    await transform({ ...factsSpawnArgs(runDir), command: "missing-senpi", env: { PATH: "" } })

    // then
    expect(warning).toBe('facts sandbox unavailable: inner command "missing-senpi" is not absolute and could not be resolved; running unsandboxed')
  }, 30_000)
})
