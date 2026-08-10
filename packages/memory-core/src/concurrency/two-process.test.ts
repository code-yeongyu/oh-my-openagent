import { afterEach, describe, expect, test } from "bun:test"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { spawn } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { buildIdentityPaths, type MemoryIdentity } from "../identity"
import { ReflectionReservationStore, type ReservationResult } from "../reflection/reservation"

const writerChildPath = fileURLToPath(new URL("./writer-child.ts", import.meta.url))
const reflectionChildPath = fileURLToPath(new URL("./reflection-child.ts", import.meta.url))
const temporaryDirectories: string[] = []
const liveChildren = new Set<ChildProcessWithoutNullStreams>()

type Exit = { readonly code: number | null; readonly signal: NodeJS.Signals | null }

type LineWaiter = {
  readonly predicate: (line: string) => boolean
  readonly resolve: (line: string) => void
}

class ChildHarness {
  readonly child: ChildProcessWithoutNullStreams
  readonly exit: Promise<Exit>
  private readonly lines: string[] = []
  private readonly waiters: LineWaiter[] = []
  private stderr = ""
  private stdoutBuffer = ""

  constructor(script: string, args: readonly string[]) {
    this.child = spawn(process.execPath, [script, ...args], { stdio: ["pipe", "pipe", "pipe"] })
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

  failureContext(): string {
    return `stdout=${JSON.stringify(this.lines)} stderr=${JSON.stringify(this.stderr)}`
  }

  private waitFor(predicate: (line: string) => boolean): Promise<string> {
    const existing = this.lines.find(predicate)
    if (existing !== undefined) return Promise.resolve(existing)
    return new Promise((resolve) => this.waiters.push({ predicate, resolve }))
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

async function git(repoPath: string, args: readonly string[]): Promise<string> {
  const child = Bun.spawn(["git", "-C", repoPath, ...args], { stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed (${exitCode}): ${stderr}`)
  return stdout
}

async function fixture(): Promise<{
  readonly root: string
  readonly identity: MemoryIdentity
  readonly contentionPath: string
}> {
  const root = await mkdtemp(join(tmpdir(), "memory-two-process-"))
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

function spawnWriter(
  fixtureValue: Awaited<ReturnType<typeof fixture>>,
  mode: "normal" | "kill-holder" | "recovery",
  writerId: string,
): ChildHarness {
  return new ChildHarness(writerChildPath, [
    mode,
    fixtureValue.identity.paths.repo,
    fixtureValue.identity.paths.locks,
    writerId,
    "10",
    fixtureValue.contentionPath,
  ])
}

async function expectSuccessful(child: ChildHarness): Promise<void> {
  const exit = await child.exit
  expect(exit, child.failureContext()).toEqual({ code: 0, signal: null })
}

async function assertTwentyLinearCommits(identity: MemoryIdentity): Promise<void> {
  expect(Number.parseInt((await git(identity.paths.repo, ["rev-list", "--count", "HEAD"])).trim(), 10)).toBe(20)
  expect(Number.parseInt((await git(identity.paths.repo, ["rev-list", "--count", "--merges", "HEAD"])).trim(), 10)).toBe(0)
  expect(await git(identity.paths.repo, ["fsck", "--full"])).toBe("")
}

afterEach(async () => {
  for (const child of liveChildren) child.kill("SIGKILL")
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("one memory identity across real Bun processes", () => {
  test("#given two synchronized tool writers #when each makes ten writes #then twenty linear commits land with observed lock contention", async () => {
    // #given
    const shared = await fixture()
    const first = spawnWriter(shared, "normal", "first")
    const second = spawnWriter(shared, "normal", "second")
    await Promise.all([first.waitForLine("ready"), second.waitForLine("ready")])
    const holding = Promise.race([first.waitForLine("holding"), second.waitForLine("holding")])
    const contended = Promise.race([first.waitForLine("contended"), second.waitForLine("contended")])

    // #when
    first.send("go")
    second.send("go")
    await Promise.all([holding, contended])
    first.send("release-first")
    second.send("release-first")
    await Promise.all([first.waitForPrefix("done:"), second.waitForPrefix("done:")])
    await Promise.all([expectSuccessful(first), expectSuccessful(second)])

    // #then
    const contentionAttempts = (await readFile(shared.contentionPath, "utf8")).split("\n").filter(Boolean)
    expect(contentionAttempts.length).toBeGreaterThanOrEqual(1)
    await assertTwentyLinearCommits(shared.identity)
  }, 30_000)

  test("#given two synchronized reflection reservers #when they race one identity #then one is active, one is pending, and completion promotes pending", async () => {
    // #given
    const shared = await fixture()
    const first = new ChildHarness(reflectionChildPath, [shared.root, shared.identity.id, "reflection-first"])
    const second = new ChildHarness(reflectionChildPath, [shared.root, shared.identity.id, "reflection-second"])
    await Promise.all([first.waitForLine("ready"), second.waitForLine("ready")])
    const firstResultLine = first.waitForPrefix("result:")
    const secondResultLine = second.waitForPrefix("result:")

    // #when
    first.send("go")
    second.send("go")
    const resultLines = await Promise.all([firstResultLine, secondResultLine])
    await Promise.all([expectSuccessful(first), expectSuccessful(second)])
    const results = resultLines.map((line) => JSON.parse(line.slice("result:".length)) as ReservationResult)

    // #then
    expect(results.map((result) => result.status).sort()).toEqual(["active", "pending"])
    const activeRecord = JSON.parse(await readFile(join(shared.identity.paths.reflection, "active.lock"), "utf8")) as ReservationResult["run"]
    const pendingRecord = JSON.parse(await readFile(join(shared.identity.paths.reflection, "pending.json"), "utf8")) as ReservationResult["run"]
    expect(activeRecord.runId).not.toBe(pendingRecord.runId)

    const store = new ReflectionReservationStore({
      identity: shared.identity,
      config: {},
      getJournal: async (conversationId) => {
        throw new Error(`unexpected journal access: ${conversationId}`)
      },
    })
    const completion = await store.complete(activeRecord.runId, "failed")
    const promoted = await store.readState()
    expect(completion.launch?.runId).toBe(pendingRecord.runId)
    expect(promoted.active?.runId).toBe(pendingRecord.runId)
    expect(promoted.pending).toBeUndefined()
    expect((JSON.parse(await readFile(join(shared.identity.paths.reflection, "active.lock"), "utf8")) as ReservationResult["run"]).runId).toBe(pendingRecord.runId)
  }, 30_000)

  test("#given a writer SIGKILLed while holding the shared lock #when its peer continues #then liveness takeover completes twenty clean commits", async () => {
    // #given
    const shared = await fixture()
    const holder = spawnWriter(shared, "kill-holder", "holder")
    const survivor = spawnWriter(shared, "recovery", "survivor")
    await Promise.all([holder.waitForLine("ready"), survivor.waitForLine("ready")])
    const killReady = holder.waitForLine("kill-ready")

    // #when
    holder.send("go")
    survivor.send("go")
    await killReady
    holder.child.kill("SIGKILL")
    expect(await holder.exit).toEqual({ code: null, signal: "SIGKILL" })
    survivor.send("begin-recovery")
    await survivor.waitForPrefix("done:")
    await expectSuccessful(survivor)

    // #then
    await assertTwentyLinearCommits(shared.identity)
  }, 30_000)
})
