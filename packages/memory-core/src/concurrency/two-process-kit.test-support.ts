// Shared cross-process harness for the two-process concurrency tests: the ChildHarness protocol
// driver, fixture repo construction, fsck/rev-list integrity oracles, and per-file cleanup. Each
// test file owns one kit instance so its afterEach only reaps the children that file spawned.

import { expect } from "bun:test"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { spawn } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths, type MemoryIdentity } from "../identity"
import { exitedWithin, probeUntil } from "../locks/process-liveness.test-support"

export const TEARDOWN_GRACE_MS = 2_000
export const DEATH_PROOF_BOUND_MS = 5_000
export const FIXTURE_REMOVAL_BOUND_MS = 5_000

export type Exit = { readonly code: number | null; readonly signal: NodeJS.Signals | null }

type LineWaiter = {
  readonly predicate: (line: string) => boolean
  readonly resolve: (line: string) => void
  readonly reject: (error: Error) => void
}

export interface ConcurrencyKit {
  readonly fixture: () => Promise<{
    readonly root: string
    readonly identity: MemoryIdentity
    readonly contentionPath: string
  }>
  readonly harnessFor: (script: string, args: readonly string[], env?: Readonly<Record<string, string>>) => ChildHarness
  readonly expectSuccessful: (child: ChildHarness) => Promise<void>
  readonly cleanup: () => Promise<void>
}

export class ChildHarness {
  readonly child: ChildProcessWithoutNullStreams
  readonly exit: Promise<Exit>
  private readonly lines: string[] = []
  private readonly waiters: LineWaiter[] = []
  private stderr = ""
  private stdoutBuffer = ""
  private closed = false

  constructor(liveChildren: Set<ChildProcessWithoutNullStreams>, script: string, args: readonly string[], extraEnv?: Readonly<Record<string, string>>) {
    this.child = spawn(process.execPath, [script, ...args], { stdio: ["pipe", "pipe", "pipe"], ...(extraEnv === undefined ? {} : { env: { ...process.env, ...extraEnv } }) })
    liveChildren.add(this.child)
    this.child.stderr.setEncoding("utf8")
    this.child.stderr.on("data", (chunk: string) => { this.stderr += chunk })
    this.child.stdout.setEncoding("utf8")
    this.child.stdout.on("data", (chunk: string) => this.acceptOutput(chunk))
    this.exit = new Promise((resolve) => {
      this.child.once("exit", (code, signal) => {
        liveChildren.delete(this.child)
        resolve({ code, signal })
      })
    })
    // `close` follows the last stdout byte, so a child that died before printing the awaited line
    // fails its waiters now, with its output attached, instead of surfacing as an opaque timeout.
    this.child.once("close", () => {
      this.closed = true
      for (const waiter of this.waiters.splice(0)) waiter.reject(this.exitedWithoutLine())
    })
  }

  send(message: string): void {
    this.child.stdin.write(`${message}\n`)
  }

  waitForLine(expected: string): Promise<string> {
    return this.waitFor((line) => line === expected)
  }

  waitForPrefix(prefix: string): Promise<string> {
    return this.waitFor((line) => line.startsWith(prefix))
  }

  // A child that killed itself: POSIX reports the signal. Windows has no signals: a self-kill is
  // TerminateProcess with exit code 1, told apart from a crash by the absence of an error on stderr.
  diedByKill(exit: Exit): boolean {
    if (exit.signal === "SIGKILL") return true
    return process.platform === "win32" && exit.code === 1 && this.stderr === ""
  }

  failureContext(): string {
    return `stdout=${JSON.stringify(this.lines)} stderr=${JSON.stringify(this.stderr)}`
  }

  private waitFor(predicate: (line: string) => boolean): Promise<string> {
    const existing = this.lines.find(predicate)
    if (existing !== undefined) return Promise.resolve(existing)
    if (this.closed) return Promise.reject(this.exitedWithoutLine())
    return new Promise((resolve, reject) => this.waiters.push({ predicate, resolve, reject }))
  }

  private exitedWithoutLine(): Error {
    return new Error(`child pid ${String(this.child.pid)} exited before the awaited line: ${this.failureContext()}`)
  }

  private acceptOutput(chunk: string): void {
    this.stdoutBuffer += chunk
    for (;;) {
      const newline = this.stdoutBuffer.indexOf("\n")
      if (newline < 0) return
      const line = this.stdoutBuffer.slice(0, newline)
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      this.lines.push(line)
      for (let index = this.waiters.length - 1; index >= 0; index -= 1) {
        const waiter = this.waiters[index]
        if (waiter?.predicate(line)) {
          this.waiters.splice(index, 1)
          waiter.resolve(line)
        }
      }
    }
  }
}

async function runGit(argv: readonly string[]): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const child = spawn("git", [...argv], { stdio: ["ignore", "pipe", "pipe"] })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject)
    child.once("close", resolve)
  })
  return { stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), exitCode }
}

export async function git(repoPath: string, args: readonly string[]): Promise<string> {
  const { stdout, stderr, exitCode } = await runGit(["-C", repoPath, ...args])
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed (${exitCode}): ${stderr}`)
  return stdout
}

// `git fsck --full --strict` is the integrity oracle for omo #10177: any error/fatal line, any
// missing or corrupt object, or a non-zero exit fails. A commit interrupted by SIGKILL can leave
// the objects it wrote unreachable (dangling); those are the normal debris of a killed write, not
// corruption, so they are reported but never fail the check. `allowedDebris` names fsck complaints
// a killed writer's stranded lock files produce BEFORE the peer's first mutation sweeps them; the
// final assertions never pass an allowance, which is what proves the sweep ran.
export async function assertRepoIntegrity(repoPath: string, allowedDebris: readonly RegExp[] = []): Promise<void> {
  const { stdout, stderr, exitCode } = await runGit(["-C", repoPath, "fsck", "--full", "--strict"])
  const report = `${stdout}\n${stderr}`
  const broken = report
    .split("\n")
    .filter((line) => /^(error|fatal):/.test(line) || /missing|corrupt/i.test(line))
    .filter((line) => !allowedDebris.some((allowed) => allowed.test(line)))
  const expectedExit = allowedDebris.length > 0 && broken.length === 0 ? exitCode : 0
  expect({ exitCode, broken }, report).toEqual({ exitCode: expectedExit, broken: [] })
}

export async function assertLinearCommits(identity: MemoryIdentity, expectedCount: number): Promise<void> {
  expect(Number.parseInt((await git(identity.paths.repo, ["rev-list", "--count", "HEAD"])).trim(), 10)).toBe(expectedCount)
  expect(Number.parseInt((await git(identity.paths.repo, ["rev-list", "--count", "--merges", "HEAD"])).trim(), 10)).toBe(0)
  await assertRepoIntegrity(identity.paths.repo)
}

// Bun's fs.rm accepts maxRetries/retryDelay but never retries (bun-v1.4.2 node_fs.rs), so the wait
// for Windows to release a just-exited child's handles lives here: bounded, loud when they never go.
async function removeFixtureRoot(directory: string): Promise<void> {
  let lastError: unknown
  const removed = await probeUntil(async () => {
    try {
      await rm(directory, { recursive: true, force: true })
      return true
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : undefined
      if (code !== "EBUSY" && code !== "EPERM" && code !== "ENOTEMPTY") throw error
      lastError = error
      return false
    }
  }, FIXTURE_REMOVAL_BOUND_MS, 200)
  if (!removed) throw new Error(`fixture root ${directory} still busy after ${String(FIXTURE_REMOVAL_BOUND_MS)}ms`, { cause: lastError })
}

export function createConcurrencyKit(): ConcurrencyKit {
  const temporaryDirectories: string[] = []
  const liveChildren = new Set<ChildProcessWithoutNullStreams>()

  async function fixture() {
    const root = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-two-process-")))
    temporaryDirectories.push(root)
    const identity: MemoryIdentity = {
      id: "shared-agent",
      safeSlug: "shared-agent",
      paths: buildIdentityPaths(root, "shared-agent"),
    }
    await mkdir(identity.paths.repo, { recursive: true })
    await git(identity.paths.repo, ["init", "-b", "main"])
    await git(identity.paths.repo, ["config", "commit.gpgsign", "false"])
    const contentionPath = join(root, "contention-attempts.log")
    await writeFile(contentionPath, "")
    return { root, identity, contentionPath }
  }

  async function cleanup(): Promise<void> {
    // Temp roots die only after every tracked child is confirmed exited: rm under a live lock
    // holder strands it, and a fire-and-forget SIGKILL is not a confirmation.
    const tracked = [...liveChildren]
    liveChildren.clear()
    for (const child of tracked) {
      if (child.exitCode !== null || child.signalCode !== null) continue
      child.kill("SIGTERM")
      if (!(await exitedWithin(child, TEARDOWN_GRACE_MS))) {
        child.kill("SIGKILL")
        if (!(await exitedWithin(child, TEARDOWN_GRACE_MS))) {
          throw new Error(`tracked child pid ${String(child.pid)} survived SIGTERM and SIGKILL teardown`)
        }
      }
    }
    await Promise.all(temporaryDirectories.splice(0).map(removeFixtureRoot))
  }

  return {
    fixture,
    cleanup,
    harnessFor: (script, args, extraEnv) => new ChildHarness(liveChildren, script, args, extraEnv),
    expectSuccessful: async (child) => {
      const exit = await child.exit
      expect(exit, child.failureContext()).toEqual({ code: 0, signal: null })
    },
  }
}
