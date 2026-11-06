import { readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"

import { shardSocketPathForKey, validateBindPath } from "../../../../senpi-task/src/runners/rpc-host/shard-socket"

export type ReloadHost = {
  readonly child: {
    readonly exitCode: number | null
    readonly signalCode: NodeJS.Signals | null
    kill(signal: NodeJS.Signals): boolean
  }
  readonly exited: Promise<void>
}

export type ReloadCleanup = {
  readonly root: string
  readonly shutdowns: ReadonlyArray<() => Promise<unknown>>
  readonly hosts: readonly ReloadHost[]
  readonly restore: () => void
  /** Whole-cleanup deadline; the caller's hook must allow it (`RELOAD_CLEANUP_HOOK_TIMEOUT_MS` for the default). */
  readonly budgetMs?: number
  /** How long SIGTERM gets before SIGKILL. */
  readonly termGraceMs?: number
  /** Time reserved after SIGKILL for the exit event. */
  readonly killWaitMs?: number
  readonly clock?: ReloadCleanupClock
}

export type ReloadCleanupClock = {
  readonly now: () => number
  readonly schedule: (callback: () => void, delayMs: number) => () => void
}

const realClock: ReloadCleanupClock = {
  now: () => Date.now(),
  schedule(callback, delayMs) {
    const timer = setTimeout(callback, delayMs)
    return () => clearTimeout(timer)
  },
}

// Every phase waits against one absolute deadline, so cleanup ends with this helper's own diagnosis (#10844).
// The SIGKILL wait is sized for a loaded Linux host: a process
// blocked in an fsync on a saturated disk is reaped only when that I/O completes, and its `exit` event arrived more
// than 12 s after SIGKILL there (#10870). The hook running the cleanup gets RELOAD_CLEANUP_HOOK_TIMEOUT_MS, which
// covers the budget, so a slow reap is reported here instead of by Bun's default hook limit.
// Mirrored from senpi packages/coding-agent/src/modes/rpc/host-ensure-stop.ts:28-29, DEFAULT_STOP_TIMEOUT_MS:
// max(5 s child stop, 60 s stalled-child stop) + 30 s child kill/reap + 5 s supervisor cleanup.
// The installed senpi package does not export this module or constant through its package exports.
const DEFAULT_TERM_GRACE_MS = 95_000
const DEFAULT_KILL_WAIT_MS = 45_000
const DEFAULT_BUDGET_MS = 12_000 + DEFAULT_TERM_GRACE_MS + DEFAULT_KILL_WAIT_MS
export const RELOAD_CLEANUP_HOOK_TIMEOUT_MS = DEFAULT_BUDGET_MS + 5_000

// The parent of a reload run's root. The runner's TMPDIR decides it whenever the host's shard socket
// (`<root>/shards/p-<key>.sock` plus its bind siblings) still fits `sun_path` there. A longer parent, such as
// darwin's ~48-byte /var/folders/.../T, falls back to /tmp so the host still binds inside the root (#10846).
export function reloadRootParent(base: string = tmpdir()): string {
  if (process.platform === "win32") return base
  const root = join(base, "omo-ulw-reload-XXXXXX")
  return validateBindPath(shardSocketPathForKey(join(root, "shards"), "p", "0".repeat(16))) ? base : "/tmp"
}

export function ownsHostSocket(launchArgs: readonly string[] | undefined, root: string): boolean {
  const index = launchArgs?.indexOf("--socket") ?? -1
  const socket = index >= 0 ? launchArgs?.[index + 1] : undefined
  return socket !== undefined && socket.startsWith(`${root}${sep}`)
}

function signalRunning(hosts: readonly ReloadHost[], signal: NodeJS.Signals): void {
  for (const { child } of hosts) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal)
  }
}

async function settlesBy<T>(work: Promise<T>, deadline: number, clock: ReloadCleanupClock): Promise<boolean> {
  let cancel: (() => void) | undefined
  try {
    return await Promise.race([
      work.then(() => true),
      new Promise<false>((resolve) => {
        cancel = clock.schedule(() => resolve(false), Math.max(0, deadline - clock.now()))
      }),
    ])
  } finally {
    cancel?.()
  }
}

export async function cleanUpReloadRun(run: ReloadCleanup): Promise<void> {
  const errors: unknown[] = []
  let escalated = false
  const budgetMs = run.budgetMs ?? DEFAULT_BUDGET_MS
  const termGraceMs = run.termGraceMs ?? DEFAULT_TERM_GRACE_MS
  const killWaitMs = run.killWaitMs ?? DEFAULT_KILL_WAIT_MS
  const clock = run.clock ?? realClock
  const deadline = clock.now() + budgetMs
  const killAt = deadline - killWaitMs
  const shutdownsBy = killAt - termGraceMs
  try {
    for (const shutdown of run.shutdowns) {
      const settled = shutdown().then(
        () => undefined,
        (error: unknown) => { errors.push(error) },
      )
      if (!(await settlesBy(settled, shutdownsBy, clock))) {
        errors.push(new Error("packaged reload plugin shutdown did not settle in time"))
        break
      }
    }
    const allExited = Promise.all(run.hosts.map(({ exited }) => exited))
    signalRunning(run.hosts, "SIGTERM")
    if (!(await settlesBy(allExited, Math.min(killAt, clock.now() + termGraceMs), clock))) {
      escalated = true
      errors.push(new Error(`supervisor did not finish graceful shutdown within ${termGraceMs}ms`))
      signalRunning(run.hosts, "SIGKILL")
      if (!(await settlesBy(allExited, deadline, clock))) throw new Error("packaged reload task host did not exit")
    }
    if (!escalated) {
      const leftovers = readdirSync(run.root).filter((name) => name.startsWith("senpi-rpc-host-internal-"))
      if (leftovers.length > 0) errors.push(new Error(`task host left ${leftovers.join(", ")} behind`))
    }
  } catch (error) {
    errors.push(error)
  } finally {
    try {
      rmSync(run.root, { recursive: true, force: true })
    } catch (error) {
      errors.push(error)
    }
    run.restore()
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, "packaged reload cleanup failed")
}
