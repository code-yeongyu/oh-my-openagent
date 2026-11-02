import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, win32 } from "node:path"

import { createNodeGitExec, type GitExec } from "../git/exec"
import { GitMemoryRepo } from "../git/repo"
import type { GitCommitAuthor } from "../git/repo-types"
import { GIT_TIMEOUT_DIAGNOSTICS_ENV, recordGitTimeout } from "../git/timeout-diagnostics"
import { git as hookGit } from "../memfs/memory-hook-git"
import { listRemotes } from "../sync/space/space"
import { removeTree } from "../../../../test-support/remove-tree"
import { resolveWin32Executable, resolveWin32Git } from "./win32-executable"
import { win32SystemExecutable } from "./win32-system-tools"

// #12146 on the real Windows filesystem: a file named like a tool and placed in the directory a
// spawn runs from must never be the program that runs. Each planted stub is a real PE executable
// (a `bun build --compile` binary) or a real batch file; when started it leaves `<its path>.ran`.

const onWin32 = process.platform === "win32"
setDefaultTimeout(onWin32 ? 60_000 : 5_000)

const AUTHOR: GitCommitAuthor = { agentId: "planted-git-row", authorName: "Planted Git Row", authorEmail: "planted@example.com" }
const BATCH_STUB = "@echo off\r\necho ran> \"%~f0.ran\"\r\nexit /b 0\r\n"
const STUB_SOURCE = "import { writeFileSync } from \"node:fs\"\nwriteFileSync(`${process.execPath}.ran`, process.argv.slice(2).join(\" \"))\n"

let root = ""
let stubExe = ""

beforeAll(() => {
  if (!onWin32) return
  root = realpathSync.native(mkdtempSync(join(tmpdir(), "omo-win32-resolver-")))
  writeFileSync(join(root, "stub.ts"), STUB_SOURCE)
  stubExe = join(root, "stub.exe")
  const built = spawnSync(process.execPath, ["build", "--compile", join(root, "stub.ts"), "--outfile", stubExe], { cwd: root, encoding: "utf8", windowsHide: true })
  if (built.status !== 0 || !existsSync(stubExe)) throw new Error(`could not build the PE stub: ${built.stderr}${built.stdout}`)
}, 180_000)

afterAll(async () => {
  if (root !== "") await removeTree(root, { maxRetries: 10, retryDelay: 200 })
})

function directory(...parts: string[]): string {
  const path = join(root, ...parts)
  mkdirSync(path, { recursive: true })
  return path
}

function plant(dir: string, names: readonly string[]): void {
  for (const name of names) {
    if (/\.(?:cmd|bat)$/i.test(name)) writeFileSync(join(dir, name), BATCH_STUB)
    else linkSync(stubExe, join(dir, name))
  }
}

function ranMarkers(...dirs: string[]): string[] {
  return dirs.flatMap((dir) => readdirSync(dir).filter((name) => name.endsWith(".ran")))
}

function clearMarkers(dir: string): void {
  for (const name of ranMarkers(dir)) rmSync(join(dir, name))
}

function environment(overrides: Record<string, string>, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const lowered = new Set(Object.keys(overrides).map((key) => key.toLowerCase()))
  const kept = Object.entries(base).filter(([key]) => !lowered.has(key.toLowerCase()))
  return { ...Object.fromEntries(kept), ...overrides }
}

function execWith(overrides: Record<string, string>): GitExec {
  const base = createNodeGitExec()
  return { run: (argv, options) => base.run(argv, { ...options, env: environment(overrides, options.env ?? process.env) }) }
}

function systemPath(): string {
  return `${win32SystemExecutable("cmd.exe").replace(/\\cmd\.exe$/i, "")}`
}

async function memoryWrite(repoDir: string, exec: GitExec): Promise<string> {
  const repo = new GitMemoryRepo({ dir: repoDir, agentId: AUTHOR.agentId, exec })
  await repo.init({ authorName: AUTHOR.authorName })
  writeFileSync(join(repoDir, ".git", "info", "exclude"), "git.*\n*.ran\n")
  writeFileSync(join(repoDir, "note.md"), "---\ndescription: planted git row\n---\nbody\n")
  return (await repo.commitWrite(["note.md"], "memory write", AUTHOR)).sha
}

function withCwd<T>(dir: string, body: () => T): T {
  const previous = process.cwd()
  process.chdir(dir)
  try {
    return body()
  } finally {
    process.chdir(previous)
  }
}

describe.if(onWin32)("win32 memory spawns never run a planted executable (#12146)", () => {
  test("#given git.exe, git.com, git.cmd and git.bat planted in the memory repo #when a memory write runs #then none runs and the real git commits", async () => {
    const repoDir = directory("direct", "repo")
    plant(repoDir, ["git.exe", "git.com", "git.cmd", "git.bat"])
    spawnSync("git", ["--version"], { cwd: repoDir, windowsHide: true })
    expect(ranMarkers(repoDir)).not.toEqual([])
    clearMarkers(repoDir)

    const sha = await memoryWrite(repoDir, createNodeGitExec())

    expect(ranMarkers(repoDir)).toEqual([])
    expect(sha).toMatch(/^[0-9a-f]{40}$/)
  })

  test("#given no git on PATH and git.com planted in the memory repo #when a memory write runs #then the Git for Windows install root commits and git.com never runs", async () => {
    const repoDir = directory("fallback", "repo")
    plant(repoDir, ["git.com"])
    const overrides = { PATH: systemPath() }
    expect(resolveWin32Git(environment(overrides))).toMatch(/\\Git\\cmd\\git\.exe$/i)
    spawnSync("git", ["--version"], { cwd: repoDir, env: environment(overrides), windowsHide: true })
    expect(ranMarkers(repoDir)).toEqual(["git.com.ran"])
    clearMarkers(repoDir)

    const sha = await memoryWrite(repoDir, execWith(overrides))

    expect(ranMarkers(repoDir)).toEqual([])
    expect(sha).toMatch(/^[0-9a-f]{40}$/)
  })

  test("#given PATH holds only a git.cmd wrapper and git.exe is planted in the memory repo #when a memory write runs #then the wrapper runs the real git and git.exe never runs", async () => {
    const realGit = resolveWin32Git(process.env)
    expect(realGit).toMatch(/\.exe$/i)
    const shim = directory("cmd-only", "shim")
    writeFileSync(join(shim, "git.cmd"), `@echo off\r\necho shim> "%~dp0shim.used"\r\n"${realGit}" %*\r\nexit /b %ERRORLEVEL%\r\n`)
    const repoDir = directory("cmd-only", "repo")
    plant(repoDir, ["git.exe"])
    const exec = createNodeGitExec()
    const env = environment({ PATH: `${shim};${systemPath()}` })
    const run = (argv: readonly string[]) => exec.run(argv, { cwd: repoDir, timeoutMs: 30_000, env })

    expect((await run(["init", "--template="])).code).toBe(0)
    writeFileSync(join(repoDir, "note.md"), "---\ndescription: cmd-only row\n---\nbody\n")
    expect((await run(["add", "--", "note.md"])).code).toBe(0)
    expect((await run(["-c", "user.name=Planted", "-c", "user.email=planted@example.com", "commit", "-m", "memory write"])).code).toBe(0)
    const head = await run(["rev-parse", "HEAD"])

    expect(head.stdout.trim()).toMatch(/^[0-9a-f]{40}$/)
    expect(existsSync(join(shim, "shim.used"))).toBe(true)
    expect(ranMarkers(repoDir)).toEqual([])
    await expect(run(["log", "--format=%H"])).rejects.toMatchObject({ code: "ERR_INVALID_ARG_VALUE" })
  })

  test("#given relative PATH entries that hold git.exe #when git is resolved and run from that directory #then the entries are skipped", async () => {
    const realGit = resolveWin32Executable("git", process.env)
    expect(realGit).toBeDefined()
    const cwd = directory("relative")
    const relbin = directory("relative", "relbin")
    plant(cwd, ["git.exe"])
    plant(relbin, ["git.exe"])
    const env = environment({ PATH: `relbin;.;C:relbin;\\relbin;${dirname(realGit ?? "")}` })

    const resolved = withCwd(cwd, () => resolveWin32Executable("git", env))
    const result = await createNodeGitExec().run(["--version"], { cwd, timeoutMs: 30_000, env })

    expect(resolved?.toLowerCase()).toBe(realGit?.toLowerCase())
    expect(result.code).toBe(0)
    expect(ranMarkers(cwd, relbin)).toEqual([])
  })

  test("#given the memory sync space probe and the memory hook #when they run from a directory holding git.exe #then the planted file never runs", async () => {
    const repoDir = directory("sites", "repo")
    expect((await createNodeGitExec().run(["init", "--template="], { cwd: repoDir, timeoutMs: 30_000 })).code).toBe(0)
    const planted = directory("sites", "planted")
    plant(planted, ["git.exe"])
    plant(repoDir, ["git.exe"])

    const remotes = withCwd(planted, () => listRemotes(repoDir))
    const insideWorkTree = hookGit(repoDir, ["rev-parse", "--is-inside-work-tree"])

    expect(remotes).toEqual([])
    expect(insideWorkTree?.trim()).toBe("true")
    expect(ranMarkers(planted, repoDir)).toEqual([])
  })

  test("#given powershell.exe planted in the working directory #when git timeout diagnostics record the process table #then System32 PowerShell runs", () => {
    const planted = directory("diagnostics", "planted")
    plant(planted, ["powershell.exe"])
    const records = directory("diagnostics", "records")

    withCwd(planted, () => recordGitTimeout({ [GIT_TIMEOUT_DIAGNOSTICS_ENV]: records }, process.pid, ["status"], planted, 1))

    expect(readdirSync(records).filter((name) => name.startsWith("git-timeout-"))).toHaveLength(1)
    expect(ranMarkers(planted)).toEqual([])
  })

  test("#given the system tools the memory engine starts #when they are located #then each is an existing absolute System32 path", () => {
    const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? ""
    for (const [tool, relative] of [
      ["reg.exe", "reg.exe"],
      ["taskkill.exe", "taskkill.exe"],
      ["cmd.exe", "cmd.exe"],
      ["powershell.exe", "WindowsPowerShell\\v1.0\\powershell.exe"],
    ] as const) {
      const located = win32SystemExecutable(tool)
      expect(located.toLowerCase()).toBe(win32.join(systemRoot, "System32", relative).toLowerCase())
      expect(existsSync(located)).toBe(true)
    }
  })
})

interface ParityRow {
  readonly name: string
  readonly files: readonly string[]
  readonly raw: (dir: (name: string) => string) => string
  readonly normalized: (dir: (name: string) => string) => readonly string[]
}

const PARITY_ROWS: readonly ParityRow[] = [
  { name: ".exe beats an earlier .com", files: ["a\\git.com", "b\\git.exe"], raw: (d) => `${d("a")};${d("b")}`, normalized: (d) => [d("a"), d("b")] },
  { name: ".cmd before .bat", files: ["a\\git.bat", "a\\git.cmd"], raw: (d) => d("a"), normalized: (d) => [d("a")] },
  { name: "earlier .cmd beats later .exe", files: ["a\\git.cmd", "b\\git.exe"], raw: (d) => `${d("a")};${d("b")}`, normalized: (d) => [d("a"), d("b")] },
  { name: ".com last pass", files: ["b\\git.com"], raw: (d) => `${d("a")};${d("b")}`, normalized: (d) => [d("a"), d("b")] },
  { name: "quoted entries", files: ["b\\git.exe"], raw: (d) => `"${d("a")}";'${d("b")}'`, normalized: (d) => [d("a"), d("b")] },
  { name: "empty entries and a trailing separator", files: ["a\\git.exe"], raw: (d) => `;;${d("a")}\\;`, normalized: (d) => [`${d("a")}\\`] },
  { name: "relative entries", files: ["a\\git.exe"], raw: (d) => `.;relbin;C:relbin;\\relbin;${d("a")}`, normalized: (d) => [d("a")] },
  { name: "no git", files: [], raw: (d) => `${d("a")};${d("b")}`, normalized: (d) => [d("a"), d("b")] },
]

function comparable(path: string | null | undefined): string | null {
  return path === null || path === undefined ? null : win32.normalize(path).toLowerCase()
}

describe.if(onWin32)("win32 resolver parity with Bun.which on fully qualified, unquoted entries", () => {
  for (const [index, row] of PARITY_ROWS.entries()) {
    test(`#given ${row.name} #when git is resolved #then the result equals Bun.which over the normalized entries`, () => {
      const rowDir = directory("parity", String(index))
      const dir = (name: string) => directory("parity", String(index), name)
      dir("a")
      dir("b")
      for (const file of row.files) writeFileSync(join(rowDir, file), "")

      const resolved = resolveWin32Executable("git", { PATH: row.raw(dir) })
      const oracle = Bun.which("git", { PATH: row.normalized(dir).join(";") })

      expect(comparable(resolved)).toBe(comparable(oracle))
    })
  }
})
