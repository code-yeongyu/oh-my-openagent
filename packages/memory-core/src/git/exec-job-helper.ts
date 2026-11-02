import { spawn, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"

import { existsSync } from "../fs/resilient"
import { getProcessStartIdentity, memoryWriterLockPath } from "../locks"
import { readOwner } from "../locks/lock-owner"
import { acquireGitActivityGate } from "./activity-gate"
import { GitAbortedError, GitHelperCrashedError, GitHelperError, GitNotFoundError } from "./errors"
import type { GitExecOptions, GitExecResult } from "./exec"
import { deleteEntryUnderGate, enoentFor, missingCwdResult, runUntilRootExit, type RunningOperation } from "./exec-job-helper-running"
import { GIT_ACTIVITY_SHARED_WAIT_MS, GitActivityLockError } from "./git-activity-lock"
import { gitOpEntryExists, writeStartedGitOpEntry } from "./git-ops-registry"
import { HelperControl } from "./helper-control"
import { HELPER_HANDSHAKE_MS, type GitJobHelperRuntime } from "./job-helper"
import { searchWindowsExecutable, windowsCommandLine } from "./win32-command-line"

// One memory-core git command on a claimed win32 host (design v4.2 sections 6.4, 7.1-7.3): resolve git, create the
// control pipe, spawn the helper detached, wait (bounded) for `joined`, then under the activity gate check that the
// writer acquisition is still current and the helper still alive, write the STARTED entry, release the gate and send
// `exec` + `go`. Git never runs without an entry, and an entry is never written for a helper that cannot run git.

let ownStart: Promise<string> | undefined

function launcherStart(): Promise<string> {
  ownStart ??= getProcessStartIdentity(process.pid).then((identity) => identity ?? "unavailable")
  return ownStart
}

/** The nonce of this process's memory-write acquisition, or null when it holds none (design section 7.1 `writerNonce`). */
async function currentWriterNonce(locksDirectory: string): Promise<string | null> {
  const owner = await readOwner(memoryWriterLockPath(locksDirectory))
  return owner?.record?.pid === process.pid ? owner.record.nonce : null
}

function execFrame(cwd: string, exe: string, commandLine: string): string {
  const field = (value: string) => `${Buffer.byteLength(value, "utf8")}:${value}`
  return `exec ${field(cwd)}${field(exe)}${field(commandLine)}\n`
}

type Spawned = { readonly child: ChildProcess; readonly stdout: Buffer[]; readonly stderr: Buffer[]; readonly streamsClosed: Promise<unknown> }

function spawnHelper(helper: GitJobHelperRuntime, op: string, options: GitExecOptions, environment: NodeJS.ProcessEnv, control: HelperControl): Spawned {
  const linger = helper.lingerMs === undefined ? [] : ["--linger-ms", String(helper.lingerMs)]
  const hasStdin = options.stdin !== undefined
  // Detached: never a member of this process's libuv job, so a writer-only kill leaves the operation running (5).
  const child = spawn(helper.path, ["run", "--op", op, ...linger], {
    env: environment,
    shell: false,
    detached: true,
    windowsHide: true,
    stdio: [hasStdin ? "pipe" : "ignore", "pipe", "pipe"],
  })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  const closed = (stream: NodeJS.ReadableStream | null) => new Promise<void>((resolve) => (stream === null ? resolve() : stream.once("close", () => resolve())))
  const streamsClosed = Promise.all([closed(child.stdout), closed(child.stderr)])
  child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk))
  child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk))
  child.on("error", () => control.helperGone())
  child.on("exit", () => control.helperGone())
  if (hasStdin && child.stdin !== null) {
    // EPIPE: git (or the helper, when nothing ran) exited before reading all of stdin; the exit code reports it.
    child.stdin.on("error", () => {})
    child.stdin.end(options.stdin)
  }
  return { child, stdout, stderr, streamsClosed }
}

async function handshake(control: HelperControl, child: ChildProcess, argv: readonly string[]): Promise<{ readonly pid: number; readonly created: string }> {
  const frame = await control.next(HELPER_HANDSHAKE_MS)
  if (frame === "interrupted") throw new GitAbortedError(argv)
  const [kind, pid = "", created = ""] = frame.split(" ")
  if (kind === "joined" && Number(pid) === child.pid && /^\d+$/.test(created)) return { pid: Number(pid), created }
  const detail = frame === "timeout" ? `no joined within ${HELPER_HANDSHAKE_MS} ms` : frame === "eof" ? "it exited before joining" : frame
  throw new GitHelperError(`The git job helper did not join its floor job (${detail}): ${argv.join(" ")}`)
}

async function admit(context: RunningOperation, helper: { readonly pid: number; readonly created: string }, writerNonce: string | null): Promise<void> {
  const { control, locksDirectory, op, argv, options } = context
  const gate = await acquireGitActivityGate(locksDirectory)
  if (gate === null) {
    await control.send("cancel\n")
    throw new GitActivityLockError(`The memory repository's git activity gate stayed held for ${GIT_ACTIVITY_SHARED_WAIT_MS} ms: ${options.cwd}`)
  }
  try {
    if (control.closed || context.child.exitCode !== null) throw new GitHelperCrashedError(`The git job helper died before git ${argv.join(" ")} could start`)
    const fenced = options.signal?.aborted === true || (writerNonce !== null && (await currentWriterNonce(locksDirectory)) !== writerNonce)
    if (fenced) throw new GitAbortedError(argv)
    if (await gitOpEntryExists(locksDirectory, op)) throw new GitHelperError(`The operation entry ${op} already exists`)
    await writeStartedGitOpEntry(locksDirectory, {
      version: 1,
      state: "started",
      op,
      job: `Global\\omo-memory-git-${op}`,
      launcher: { pid: process.pid, process_start: await launcherStart() },
      helper,
      writer_nonce: writerNonce,
    })
  } catch (error) {
    if (!(error instanceof GitHelperCrashedError)) await control.send("cancel\n")
    throw error
  } finally {
    gate.release()
  }
}

export async function runGitThroughJobHelper(
  executable: string,
  argv: readonly string[],
  options: GitExecOptions,
  environment: NodeJS.ProcessEnv,
  helper: GitJobHelperRuntime,
  locksDirectory: string,
): Promise<GitExecResult> {
  if (options.signal?.aborted === true) throw new GitAbortedError(argv)
  const gitPath = searchWindowsExecutable(executable, options.cwd, environment)
  if (gitPath === null) {
    if (!existsSync(options.cwd)) return missingCwdResult(options.cwd)
    throw new GitNotFoundError({ cause: enoentFor(executable) })
  }
  const writerNonce = await currentWriterNonce(locksDirectory)
  const op = randomUUID()
  const control = await HelperControl.listen(op)
  const spawned = spawnHelper(helper, op, options, environment, control)
  const onEarlyAbort = () => control.interrupt()
  options.signal?.addEventListener("abort", onEarlyAbort, { once: true })
  const operation: RunningOperation = { argv, options, environment, locksDirectory, op, control, ...spawned, startedAt: Date.now() }
  let joined = false
  try {
    const identity = await handshake(control, spawned.child, argv)
    joined = true
    await admit(operation, identity, writerNonce)
    options.signal?.removeEventListener("abort", onEarlyAbort)
    if (!(await control.send(execFrame(options.cwd, gitPath, windowsCommandLine([executable, ...argv])) + "go\n"))) {
      await deleteEntryUnderGate(locksDirectory, op)
      throw new GitHelperCrashedError(`The git job helper died before git ${argv.join(" ")} could start`)
    }
    return await runUntilRootExit(operation, executable)
  } finally {
    options.signal?.removeEventListener("abort", onEarlyAbort)
    if (!joined && spawned.child.exitCode === null) spawned.child.kill()
    control.dispose()
    spawned.child.stdin?.destroy()
    spawned.child.stdout?.destroy()
    spawned.child.stderr?.destroy()
    spawned.child.unref()
  }
}
