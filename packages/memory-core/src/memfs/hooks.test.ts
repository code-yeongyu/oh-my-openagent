import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test"
import { spawn } from "node:child_process"
import { existsSync, realpathSync, statSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { installHooks, resolveHooksDir } from "./hooks"
import { POST_COMMIT_HOOK_SCRIPT, PRE_COMMIT_HOOK_SCRIPT } from "./hooks-scripts"

const tempDirs: string[] = []

interface RunResult {
  code: number
  stdout: string
  stderr: string
}

function run(argv: readonly string[], cwd: string, env: NodeJS.ProcessEnv = {}): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(argv[0] ?? "", argv.slice(1), {
      cwd,
      env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()))
    child.on("error", reject)
    child.on("close", (code) => resolvePromise({ code: code ?? 1, stdout, stderr }))
  })
}

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function createRepo(): Promise<string> {
  const dir = await tempDir("memory-hooks-")
  await run(["git", "init", "--quiet"], dir)
  await run(["git", "symbolic-ref", "HEAD", "refs/heads/main"], dir)
  await run(["git", "config", "user.email", "agent@omo.local"], dir)
  await run(["git", "config", "user.name", "Omo Agent"], dir)
  await run(["git", "config", "commit.gpgsign", "false"], dir)
  installHooks(dir)
  return dir
}

async function writeFiles(dir: string, files: Record<string, string>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(dir, relativePath)
    await mkdir(dirname(fullPath), { recursive: true })
    await writeFile(fullPath, content, "utf8")
  }
}

async function commit(
  dir: string,
  files: Record<string, string>,
  message = "memory write",
  env: NodeJS.ProcessEnv = {},
): Promise<RunResult> {
  await writeFiles(dir, files)
  await run(["git", "add", "-A"], dir)
  return run(["git", "commit", "-m", message], dir, env)
}

const VALID = "---\ndescription: Persona of the agent\n---\n\nbody\n"
const LOCKED = "---\ndescription: Locked\nread_only: true\n---\n\nbody\n"

/**
 * Commits a server-provided file. `read_only` may only enter the repository
 * outside the agent's edit path, so seeding bypasses the hook the same way the
 * sync path does.
 */
async function seedServerFile(dir: string, relativePath: string, content: string): Promise<void> {
  await writeFiles(dir, { [relativePath]: content })
  await run(["git", "add", "-A"], dir)
  const result = await run(["git", "commit", "--no-verify", "-m", "sync from server"], dir)
  if (result.code !== 0) throw new Error(`seed failed: ${result.stdout}${result.stderr}`)
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

setDefaultTimeout(process.platform === "win32" ? 30000 : 5000)

describe("installHooks", () => {
  it("#given a repository #when hooks are installed twice #then both hooks stay executable and identical", async () => {
    // given
    const dir = await createRepo()
    const hookPath = join(dir, ".git", "hooks", "pre-commit")
    const first = await readFile(hookPath, "utf8")

    // when
    await writeFile(hookPath, "#!/bin/sh\nexit 1\n", "utf8")
    const installed = installHooks(dir)

    // then
    expect(installed.map((hook) => hook.name)).toEqual(["pre-commit", "post-commit"])
    expect(await readFile(hookPath, "utf8")).toBe(first)
    if (process.platform !== "win32") {
      for (const hook of installed) {
        expect(statSync(hook.path).mode & 0o777).toBe(0o755)
      }
    }
  })

  it("#given the hook scripts #when checked for portability #then they parse as POSIX sh without bash-only constructs", async () => {
    // given
    const dir = await tempDir("memory-hooks-syntax-")
    // letta's originals used these bash-only constructs; dash rejects them.
    // The ANSI-C quote must open a token, so `'^---$'` is not a match.
    const bashOnly = [/<<</, /echo -e/, /(^|[\s=(])\$'/, /disown/, /env bash/]

    // when
    await writeFiles(dir, { "pre-commit": PRE_COMMIT_HOOK_SCRIPT, "post-commit": POST_COMMIT_HOOK_SCRIPT })

    // then
    for (const script of [PRE_COMMIT_HOOK_SCRIPT, POST_COMMIT_HOOK_SCRIPT]) {
      expect(script.startsWith("#!/bin/sh\n")).toBe(true)
      for (const construct of bashOnly) expect(script).not.toMatch(construct)
    }
    for (const hook of ["pre-commit", "post-commit"]) {
      expect((await run(["sh", "-n", hook], dir)).code).toBe(0)
    }
  })

  it("#given a linked worktree #when hooks are installed #then they land in the shared hooks directory", async () => {
    // given
    const dir = await createRepo()
    await commit(dir, { "system/persona.md": VALID })
    const worktreeParent = await tempDir("memory-hooks-wt-")
    const worktree = join(worktreeParent, "checkout")
    await run(["git", "worktree", "add", "-b", "memory/reflection", worktree], dir)

    // when
    const installed = installHooks(worktree)

    // then (resolve against git's own canonical common-dir so 8.3 short names cannot diverge)
    const gitCommonDir = (await run(["git", "rev-parse", "--git-common-dir"], worktree)).stdout.trim()
    const sharedHooks = join(gitCommonDir, "hooks")
    expect(resolveHooksDir(worktree)).toBe(sharedHooks)
    expect(installed[0]?.path).toBe(join(sharedHooks, "pre-commit"))
    expect(existsSync(join(worktree, ".git", "hooks"))).toBe(false)
  })
})

describe("pre-commit hook", () => {
  it("#given valid memory markdown #when it is committed #then the hook accepts every supported shape", async () => {
    // given
    const dir = await createRepo()

    // when
    const result = await commit(dir, {
      "system/persona.md": VALID,
      "reference/notes.md": "---\ndescription: Notes\nlimit: 5000\n---\n\nnotes\n",
      "memory/system/legacy.md": "---\ndescription: Legacy layout\n---\n\nlegacy\n",
      "skills/deploy/SKILL.md": "---\nname: deploy\nunknown_key: fine\n---\n\nsteps\n",
      "README.md": "no frontmatter here\n",
    })

    // then
    expect(result.code).toBe(0)
    expect(await run(["git", "log", "--oneline"], dir).then((log) => log.stdout)).toContain("memory write")
  })

  it("#given a read_only file from the server #when an unrelated file changes #then the commit still succeeds", async () => {
    // given
    const dir = await createRepo()
    await seedServerFile(dir, "system/locked.md", LOCKED)

    // when
    const result = await commit(dir, { "system/persona.md": VALID }, "add persona")

    // then
    expect(result.code).toBe(0)
  })

  const rejections: readonly { rule: string; files: Record<string, string>; reason: string }[] = [
    {
      rule: "missing frontmatter",
      files: { "system/persona.md": "just a body\n" },
      reason: "missing frontmatter (must start with ---)",
    },
    {
      rule: "unclosed frontmatter",
      files: { "system/persona.md": "---\ndescription: Persona\n\nbody\n" },
      reason: "frontmatter opened but never closed",
    },
    {
      rule: "empty description",
      files: { "system/persona.md": "---\ndescription:\n---\n\nbody\n" },
      reason: "'description' must not be empty",
    },
    {
      rule: "multi-line description",
      files: { "system/persona.md": "---\ndescription: >\n  wrapped text\n---\n\nbody\n" },
      reason: "'description' must be a non-empty single line",
    },
    {
      rule: "missing description",
      files: { "reference/notes.md": "---\nlimit: 5000\n---\n\nbody\n" },
      reason: "missing required field 'description'",
    },
    {
      rule: "unknown key",
      files: { "system/persona.md": "---\ndescription: Persona\npriority: high\n---\n\nbody\n" },
      reason: "unknown frontmatter key 'priority'",
    },
    {
      rule: "read_only added by the agent",
      files: { "system/persona.md": "---\ndescription: Persona\nread_only: true\n---\n\nbody\n" },
      reason: "'read_only' is a protected field and cannot be set by the agent",
    },
    {
      rule: "flat skill file",
      files: { "skills/deploy.md": "---\ndescription: Deploy\n---\n\nsteps\n" },
      reason: "invalid skill path (skills must be folders)",
    },
    {
      rule: "legacy flat skill file",
      files: { "memory/skills/deploy.md": "---\ndescription: Deploy\n---\n\nsteps\n" },
      reason: "invalid skill path (skills must be folders)",
    },
  ]

  for (const { rule, files, reason } of rejections) {
    it(`#given ${rule} #when the commit runs #then the hook rejects it`, async () => {
      // given
      const dir = await createRepo()

      // when
      const result = await commit(dir, files)

      // then
      expect(result.code).not.toBe(0)
      expect(result.stdout + result.stderr).toContain("Frontmatter validation failed:")
      expect(result.stdout + result.stderr).toContain(reason)
      expect((await run(["git", "log", "--oneline"], dir)).code).not.toBe(0)
    })
  }

  const readOnlyTampers: readonly { rule: string; seeded: string; content: string; reason: string }[] = [
    {
      rule: "the body of a read_only file is edited",
      seeded: LOCKED,
      content: "---\ndescription: Locked\nread_only: true\n---\n\ntampered\n",
      reason: "file is read_only and cannot be modified",
    },
    {
      rule: "only the description of a read_only file is edited",
      seeded: LOCKED,
      content: "---\ndescription: Renamed\nread_only: true\n---\n\nbody\n",
      reason: "file is read_only and cannot be modified",
    },
    {
      // read_only: false is still a protected key: dropping it is tampering.
      // A read_only: true file never reaches this rule because the whole file
      // is frozen by the earlier check.
      rule: "an unlocked read_only key is removed",
      seeded: "---\ndescription: Tunable\nread_only: false\n---\n\nbody\n",
      content: "---\ndescription: Tunable\n---\n\nedited\n",
      reason: "'read_only' is a protected field and cannot be removed by the agent",
    },
  ]

  for (const { rule, seeded, content, reason } of readOnlyTampers) {
    it(`#given a committed read_only file #when ${rule} #then the hook rejects the commit`, async () => {
      // given
      const dir = await createRepo()
      await seedServerFile(dir, "system/locked.md", seeded)

      // when
      const result = await commit(dir, { "system/locked.md": content }, "tamper")

      // then
      expect(result.code).not.toBe(0)
      expect(result.stdout + result.stderr).toContain(reason)
      expect((await run(["git", "show", "HEAD:system/locked.md"], dir)).stdout).toBe(seeded)
    })
  }

  it("#given a file whose HEAD read_only is false #when the agent flips it to true #then the change is rejected", async () => {
    // given
    const dir = await createRepo()
    await seedServerFile(dir, "system/tunable.md", "---\ndescription: Tunable\nread_only: false\n---\n\nbody\n")

    // when
    const result = await commit(
      dir,
      { "system/tunable.md": "---\ndescription: Tunable\nread_only: true\n---\n\nbody\n" },
      "escalate",
    )

    // then
    expect(result.code).not.toBe(0)
    expect(result.stdout + result.stderr).toContain(
      "'read_only' is a protected field and cannot be changed by the agent",
    )
  })
})

describe("post-commit mirror push", () => {
  async function createMirror(): Promise<string> {
    const dir = await tempDir("memory-mirror-")
    await run(["git", "init", "--bare", "--quiet", "--initial-branch=main"], dir)
    return dir
  }

  function logPath(repo: string): string {
    return join(repo, ".git", "memory-repository-push.log")
  }

  const SYNC = { OMO_MEMORY_PUSH_SYNC: "1" }

  it("#given a configured mirror #when a commit lands on main #then it is pushed and logged", async () => {
    // given
    const dir = await createRepo()
    const mirror = await createMirror()
    await run(["git", "config", "--local", "omo.memoryRepository.url", `file://${mirror}`], dir)

    // when
    const result = await commit(dir, { "system/persona.md": VALID }, "remember", SYNC)

    // then
    expect(result.code).toBe(0)
    const log = await readFile(logPath(dir), "utf8")
    expect(log).toContain("on main")
    expect(log).toContain("exit=0")
    const mirrored = await run(["git", "show", "main:system/persona.md"], mirror)
    expect(mirrored.stdout).toBe(VALID)
  })

  it("#given no configured mirror #when a commit lands #then the hook no-ops without a log", async () => {
    // given
    const dir = await createRepo()

    // when
    const result = await commit(dir, { "system/persona.md": VALID }, "remember", SYNC)

    // then
    expect(result.code).toBe(0)
    expect(existsSync(logPath(dir))).toBe(false)
  })

  it("#given a reflection branch and a detached HEAD #when commits land #then nothing is pushed", async () => {
    // given
    const dir = await createRepo()
    const mirror = await createMirror()
    await run(["git", "config", "--local", "omo.memoryRepository.url", `file://${mirror}`], dir)
    await commit(dir, { "system/persona.md": VALID }, "seed", SYNC)
    await rm(logPath(dir))

    // when
    await run(["git", "checkout", "--quiet", "-b", "memory/reflection"], dir)
    await commit(dir, { "reference/notes.md": "---\ndescription: Notes\n---\n\nnotes\n" }, "branch write", SYNC)
    await run(["git", "checkout", "--quiet", "--detach"], dir)
    await commit(dir, { "reference/more.md": "---\ndescription: More\n---\n\nmore\n" }, "detached write", SYNC)

    // then
    expect(existsSync(logPath(dir))).toBe(false)
    expect((await run(["git", "log", "--oneline", "main"], mirror)).stdout).toContain("seed")
  })

  it("#given an unreachable mirror #when a commit lands #then the commit succeeds and the failure is logged", async () => {
    // given
    const dir = await createRepo()
    const missing = join(await tempDir("memory-missing-"), "gone.git")
    await run(["git", "config", "--local", "omo.memoryRepository.url", `file://${missing}`], dir)

    // when
    const result = await commit(dir, { "system/persona.md": VALID }, "remember", SYNC)

    // then
    expect(result.code).toBe(0)
    const log = await readFile(logPath(dir), "utf8")
    expect(log).not.toContain("exit=0")
    expect((await run(["git", "log", "--oneline"], dir)).stdout).toContain("remember")
  })

  it("#given the default background push #when a commit lands #then the mirror receives it without blocking the commit", async () => {
    // given
    const dir = await createRepo()
    const mirror = await createMirror()
    await run(["git", "config", "--local", "omo.memoryRepository.url", `file://${mirror}`], dir)

    // when
    const result = await commit(dir, { "system/persona.md": VALID }, "background remember")

    // then
    expect(result.code).toBe(0)
    await waitFor(async () => (await readFile(logPath(dir), "utf8").catch(() => "")).includes("exit=0"))
    expect((await run(["git", "show", "main:system/persona.md"], mirror)).stdout).toBe(VALID)
  })
})

/**
 * Awaits a state change with a bounded deadline. The post-commit push runs in
 * a detached child process, so the log transition is observable only by
 * polling the file it appends to.
 */
async function waitFor(condition: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10))
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`)
}
