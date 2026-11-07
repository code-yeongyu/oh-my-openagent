import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { spawn, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { createInterface } from "node:readline"

import { removeTree } from "../../../../test-support/remove-tree"
import { memoryWriterLockPath, parseLockRecord } from "../locks"
import { acquireGitActivityGate, type GitActivityGate } from "./activity-gate"
import { GIT_ACTIVITY_JOB_PROTOCOL } from "./job-helper"
import {
  WRITER_SCRIPT,
  compileHelperStub,
  gitOpEntries,
  gitSucceeds,
  identityRepo,
  jobHelperPath,
  requireJobHelperWhenDemanded,
  runsJobHelperRows,
  type IdentityRepo,
} from "./job-helper-fixtures.test-support"
import {
  JOB_MSG_ABNORMAL_EXIT_PROCESS,
  JOB_MSG_EXIT_PROCESS,
  JOB_MSG_NEW_PROCESS,
  OuterJob,
  closeHandle,
  exitCodeOf,
  exitFiletimeOf,
  jobAccounting,
  jobProcessIds,
  processCommandLine,
  processImage,
  signaledWithin,
  watchProcess,
} from "./windows-job-observer.test-support"

requireJobHelperWhenDemanded()

// Rows T7(c), T7(d) and T8 run writer P as its own process inside a test-owned outer job with a completion port and
// no breakaway, so the test learns of the helper's creation and exit from the job and never from P (design v4.2 T7).
type Writer = { readonly child: ChildProcess; line(prefixes: readonly string[], boundMs: number): Promise<string> }

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function startWriter(fixture: IdentityRepo, helper: string, argv: readonly string[], holdWriterLock: boolean, env: Record<string, string> = {}): Writer {
  const config = { repo: fixture.paths.repo, locks: fixture.paths.locks, helper: { path: helper }, argv, holdWriterLock, env }
  const child = spawn(process.execPath, [WRITER_SCRIPT, JSON.stringify(config)], { stdio: ["pipe", "pipe", "inherit"], windowsHide: true })
  const seen: string[] = []
  const waiters = new Set<() => void>()
  createInterface({ input: child.stdout! }).on("line", (text) => {
    seen.push(text)
    for (const waiter of waiters) waiter()
  })
  cleanups.push(() => {
    if (child.exitCode === null) child.kill()
  })
  return {
    child,
    line: (prefixes, boundMs) => new Promise((resolve, reject) => {
      const check = () => {
        const found = seen.find((text) => prefixes.some((prefix) => text.startsWith(prefix)))
        if (found === undefined) return
        clearTimeout(timer)
        waiters.delete(check)
        resolve(found)
      }
      const timer = setTimeout(() => {
        waiters.delete(check)
        reject(new Error(`writer never printed ${prefixes.join(" or ")} within ${boundMs} ms; saw ${JSON.stringify(seen)}`))
      }, boundMs)
      waiters.add(check)
      check()
    }),
  }
}

async function admit(writer: Writer): Promise<OuterJob> {
  // P joins the outer job before it spawns anything, as a writer started inside a job does: adopting P after its
  // libuv kill-on-close job exists would put the helper in that job, so killing P would kill the helper (#10391).
  await writer.line(["spawned"], 30_000)
  const outer = OuterJob.create()
  cleanups.push(() => outer.close())
  outer.assign(writer.child.pid ?? 0)
  writer.child.stdin!.write("assigned\n")
  // P claimed the protocol: its cached `selftest` passed at lock-record creation (design section 6.3).
  expect(await writer.line(["ready"], 30_000)).toBe(`ready ${GIT_ACTIVITY_JOB_PROTOCOL}`)
  writer.child.stdin!.write("start\n")
  return outer
}

async function holdGate(locks: string): Promise<GitActivityGate> {
  const gate = await acquireGitActivityGate(locks)
  if (gate === null) throw new Error("the test could not take the activity gate")
  let released = false
  const release = () => {
    if (released) return
    released = true
    gate.release()
  }
  cleanups.push(release)
  return { release }
}

/** `message:pid:image:command line` of one process, resolved now (null fields when it is gone). */
function describeProcess(message: number, pid: number): string {
  return `${message}:${pid}:${basename(processImage(pid) ?? "?")}:${processCommandLine(pid) ?? "?"}`
}

// The run helper H, by image AND `run --op`: P's claim `selftest` (same image) is created inside the job too.
async function helperCreated(outer: OuterJob, image: string, seen: string[] = []): Promise<{ readonly pid: number; readonly handle: bigint }> {
  const created = await outer.next(({ message, pid }) => {
    seen.push(describeProcess(message, pid))
    return message === JOB_MSG_NEW_PROCESS && basename(processImage(pid) ?? "").toLowerCase() === image.toLowerCase() && / run --op /.test(processCommandLine(pid) ?? "")
  }, 60_000)
  const handle = watchProcess(created.pid)
  if (handle === null) throw new Error(`helper ${created.pid} exited before the test could watch it`)
  cleanups.push(() => closeHandle(handle))
  return { pid: created.pid, handle }
}

async function fixture(prefix: string): Promise<IdentityRepo> {
  const repo = await identityRepo(prefix, `outer-${randomUUID().slice(0, 8)}`)
  cleanups.push(() => removeTree(repo.root, { maxRetries: 10, retryDelay: 200 }))
  return repo
}

describe.skipIf(!runsJobHelperRows)("T7(c)(d) and T8: the writer never lets git run without a current entry (design v4.2 sections 6.4, 7.1, 7.3)", () => {
  let stubDirectory = ""
  let stub = ""
  beforeAll(async () => {
    stubDirectory = await mkdtemp(join(tmpdir(), "job-helper-outer-stub-"))
    stub = await compileHelperStub(stubDirectory)
  }, 180_000)
  afterAll(async () => {
    if (stubDirectory) await removeTree(stubDirectory, { maxRetries: 10, retryDelay: 200 })
  })

  // Kills P once its helper H exists while the test holds the gate, and returns H's exit code plus a receipt: what
  // matched, the job traffic, and whether H ended at P's death (same exit FILETIME) or later on its own EOF path.
  async function killWriterOnceHelperExists(label: string): Promise<{ readonly code: number | null; readonly repo: IdentityRepo }> {
    const repo = await fixture(`job-helper-${label}-`)
    const gate = await holdGate(repo.paths.locks)
    const writer = startWriter(repo, jobHelperPath(), ["tag", "t7c"], false)
    const outer = await admit(writer)
    const writerHandle = watchProcess(writer.child.pid ?? 0)
    if (writerHandle === null) throw new Error("writer exited before the test could watch it")
    cleanups.push(() => closeHandle(writerHandle))
    const seen: string[] = []
    const helper = await helperCreated(outer, basename(jobHelperPath()), seen)
    const atMatch = { writer: writer.child.pid, members: jobProcessIds(outer.job).map((pid) => describeProcess(0, pid)), accounting: jobAccounting(outer.job) }
    writer.child.kill()
    expect(await signaledWithin(writerHandle, 30_000)).toBe(true)
    expect(await signaledWithin(helper.handle, 30_000)).toBe(true)
    const code = exitCodeOf(helper.handle)
    const [writerEnd, helperEnd] = [exitFiletimeOf(writerHandle), exitFiletimeOf(helper.handle)]
    const after = outer.drain().map(({ message, pid }) => describeProcess(message, pid))
    const tagged = gitSucceeds(repo.paths.repo, ["rev-parse", "--verify", "--quiet", "refs/tags/t7c"])
    const helperAfterWriterMs = writerEnd === null || helperEnd === null ? null : Number(helperEnd - writerEnd) / 10_000
    console.log(`[${label}] ${JSON.stringify({ helper: helper.pid, exit: code, helperAfterWriterMs, seen, atMatch, after, accounting: jobAccounting(outer.job), tagged, entries: await gitOpEntries(repo.paths.locks) })}`)
    gate.release()
    return { code, repo }
  }

  test("T7(c): #given the test holds the activity gate #when writer P is killed once its helper exists #then the helper exits with no git and no entry is written", async () => {
    // #given #when
    const { code, repo } = await killWriterOnceHelperExists("T7(c)")

    // #then
    expect([11, 20]).toContain(code ?? -1)
    expect(gitSucceeds(repo.paths.repo, ["rev-parse", "--verify", "--quiet", "refs/tags/t7c"])).toBe(false)
    expect(await gitOpEntries(repo.paths.locks)).toEqual([])
  }, 120_000)


  test("T7(d): #given a stub that sends joined and exits while the test holds the gate #when the gate is released after the outer job reports the stub's exit #then P rejects GitHelperCrashedError and no entry remains", async () => {
    // #given
    const repo = await fixture("job-helper-t7d-")
    const gate = await holdGate(repo.paths.locks)
    const writer = startWriter(repo, stub, ["tag", "t7d"], false, { OMO_TEST_STUB_MODE: "joined-exit" })

    // #when
    const outer = await admit(writer)
    const created = await helperCreated(outer, basename(stub))
    await outer.next(({ message, pid }) => (message === JOB_MSG_EXIT_PROCESS || message === JOB_MSG_ABNORMAL_EXIT_PROCESS) && pid === created.pid, 60_000)
    gate.release()
    const outcome = await writer.line(["error ", "result "], 60_000)

    // #then
    expect(outcome).toStartWith("error GitHelperCrashedError ")
    expect(gitSucceeds(repo.paths.repo, ["rev-parse", "--verify", "--quiet", "refs/tags/t7d"])).toBe(false)
    expect(await gitOpEntries(repo.paths.locks)).toEqual([])
  }, 120_000)

  test("T8: #given P holds the memory-write lock and waits on the gate #when its acquisition is replaced before go #then P sends cancel, rejects GitAbortedError, git never runs and no entry exists", async () => {
    // #given
    const repo = await fixture("job-helper-t8-")
    const gate = await holdGate(repo.paths.locks)
    const writer = startWriter(repo, jobHelperPath(), ["tag", "t8"], true)
    const outer = await admit(writer)
    const nonce = (await writer.line(["locked "], 30_000)).slice("locked ".length)

    // #when
    const helper = await helperCreated(outer, basename(jobHelperPath()))
    const lockPath = memoryWriterLockPath(repo.paths.locks)
    const current = parseLockRecord(await readFile(lockPath, "utf8"))
    expect(current?.nonce).toBe(nonce)
    await writeFile(lockPath, JSON.stringify({ ...current, nonce: randomUUID() }), "utf8")
    gate.release()
    const outcome = await writer.line(["error ", "result "], 60_000)

    // #then
    expect(outcome).toStartWith("error GitAbortedError ")
    expect(await signaledWithin(helper.handle, 30_000)).toBe(true)
    expect(exitCodeOf(helper.handle)).toBe(20)
    expect(gitSucceeds(repo.paths.repo, ["rev-parse", "--verify", "--quiet", "refs/tags/t8"])).toBe(false)
    expect(await gitOpEntries(repo.paths.locks)).toEqual([])
  }, 120_000)
})
