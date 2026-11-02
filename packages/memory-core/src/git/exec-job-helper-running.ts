import type { ChildProcess } from "node:child_process"

import { existsSync } from "../fs/resilient"
import { acquireGitActivityGate } from "./activity-gate"
import { GitAbortedError, GitHelperCrashedError, GitHelperError, GitNotFoundError, GitTimeoutError } from "./errors"
import { GIT_EXIT_DRAIN_MS, type GitExecOptions, type GitExecResult } from "./exec"
import { deleteGitOpEntry } from "./git-ops-registry"
import type { HelperControl } from "./helper-control"
import { recordGitTimeout } from "./timeout-diagnostics"

// RUNNING, from P's side (design v4.2 sections 7.3, 9, 16): the helper reports `spawned`, then `exit <code>
// empty|lingering` at root exit. Timeout and abort send `terminate-root` (the launcher only, like today's SIGTERM on
// win32) and reject once the root has exited. On `empty` P deletes the entry under the gate BEFORE run() resolves, so
// a sweep that follows the command never sees its own entry; on `lingering` the entry stays and busy is correct.

export type RunningOperation = {
  readonly argv: readonly string[]
  readonly options: GitExecOptions
  readonly environment: NodeJS.ProcessEnv
  readonly locksDirectory: string
  readonly op: string
  readonly control: HelperControl
  readonly child: ChildProcess
  readonly stdout: readonly Buffer[]
  readonly stderr: readonly Buffer[]
  readonly streamsClosed: Promise<unknown>
  readonly startedAt: number
}

export function missingCwdResult(cwd: string): GitExecResult {
  return { code: 128, stdout: "", stderr: `fatal: cannot change to '${cwd}': No such file or directory` }
}

export function enoentFor(executable: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`spawn ${executable} ENOENT`), { code: "ENOENT", errno: -4058, syscall: `spawn ${executable}`, path: executable })
}

/** Deletes P's own entry under the gate; an entry the gate cannot be taken for is left for the next probe to collect. */
export async function deleteEntryUnderGate(locksDirectory: string, op: string): Promise<void> {
  const gate = await acquireGitActivityGate(locksDirectory)
  if (gate === null) return
  try {
    await deleteGitOpEntry(locksDirectory, op)
  } finally {
    gate.release()
  }
}

async function drained(operation: RunningOperation): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const bound = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, operation.options.exitDrainMs ?? GIT_EXIT_DRAIN_MS)
  })
  await Promise.race([operation.streamsClosed, bound])
  clearTimeout(timer)
}

async function spawnFailed(operation: RunningOperation, executable: string, code: string): Promise<GitExecResult> {
  await deleteEntryUnderGate(operation.locksDirectory, operation.op)
  if (!existsSync(operation.options.cwd)) return missingCwdResult(operation.options.cwd)
  if (code === "2" || code === "3") throw new GitNotFoundError({ cause: enoentFor(executable) })
  throw new GitHelperError(`The git job helper could not start git (spawn-failed ${code}): ${operation.argv.join(" ")}`)
}

export async function runUntilRootExit(operation: RunningOperation, executable: string): Promise<GitExecResult> {
  const { argv, options, control } = operation
  let timedOut = false
  let aborted = false
  let rootPid: number | undefined
  const stopRoot = () => void control.send("terminate-root\n")
  const timer = setTimeout(() => {
    timedOut = true
    recordGitTimeout(operation.environment, rootPid, argv, options.cwd, options.timeoutMs)
    stopRoot()
  }, options.timeoutMs)
  const onAbort = () => {
    aborted = true
    stopRoot()
  }
  if (options.signal?.aborted === true) onAbort()
  else options.signal?.addEventListener("abort", onAbort, { once: true })
  try {
    for (;;) {
      const frame = await control.next()
      if (frame === "interrupted") continue
      if (frame === "eof" || frame === "timeout") {
        throw new GitHelperCrashedError(`The git job helper died while running git ${argv.join(" ")}`)
      }
      const [kind, first = "", second = ""] = frame.split(" ")
      if (kind === "spawned") rootPid = Number(first)
      if (kind === "spawn-failed") return await spawnFailed(operation, executable, first)
      if (kind !== "exit") continue
      if (second === "empty") await deleteEntryUnderGate(operation.locksDirectory, operation.op)
      if (aborted) throw new GitAbortedError(argv)
      if (timedOut) throw new GitTimeoutError(argv, options.timeoutMs)
      await drained(operation)
      const stdoutBytes = Buffer.concat(operation.stdout)
      return {
        code: Number(first),
        stdout: stdoutBytes.toString("utf8"),
        stderr: Buffer.concat(operation.stderr).toString("utf8"),
        stdoutBytes,
        termination: { signal: null, elapsedMs: Date.now() - operation.startedAt },
      }
    }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener("abort", onAbort)
  }
}
