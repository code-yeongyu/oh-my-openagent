import { readdirSync, rmSync } from "node:fs"
import { sep } from "node:path"

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
}

// Every phase waits against one absolute deadline, so a host slow to honour SIGTERM is killed early and the cleanup
// ends with this helper's own diagnosis (#10844). The SIGKILL wait is sized for a loaded Linux host: a process
// blocked in an fsync on a saturated disk is reaped only when that I/O completes, and its `exit` event arrived more
// than 12 s after SIGKILL there (#10870). The hook running the cleanup gets RELOAD_CLEANUP_HOOK_TIMEOUT_MS, which
// covers the budget, so a slow reap is reported here instead of by Bun's default hook limit.
const DEFAULT_BUDGET_MS = 60_000
const DEFAULT_TERM_GRACE_MS = 3_000
const DEFAULT_KILL_WAIT_MS = 45_000
export const RELOAD_CLEANUP_HOOK_TIMEOUT_MS = DEFAULT_BUDGET_MS + 5_000

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

async function settlesBy<T>(work: Promise<T>, deadline: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), Math.max(0, deadline - Date.now()))
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function cleanUpReloadRun(run: ReloadCleanup): Promise<void> {
  const errors: unknown[] = []
  let exited = false
  const budgetMs = run.budgetMs ?? DEFAULT_BUDGET_MS
  const termGraceMs = run.termGraceMs ?? DEFAULT_TERM_GRACE_MS
  const killWaitMs = run.killWaitMs ?? DEFAULT_KILL_WAIT_MS
  const deadline = Date.now() + budgetMs
  const killAt = deadline - killWaitMs
  const shutdownsBy = killAt - termGraceMs
  try {
    for (const shutdown of run.shutdowns) {
      const settled = shutdown().then(
        () => undefined,
        (error: unknown) => { errors.push(error) },
      )
      if (!(await settlesBy(settled, shutdownsBy))) {
        errors.push(new Error("packaged reload plugin shutdown did not settle in time"))
        break
      }
    }
    const allExited = Promise.all(run.hosts.map(({ exited }) => exited))
    signalRunning(run.hosts, "SIGTERM")
    if (!(await settlesBy(allExited, Math.min(killAt, Date.now() + termGraceMs)))) {
      signalRunning(run.hosts, "SIGKILL")
      if (!(await settlesBy(allExited, deadline))) throw new Error("packaged reload task host did not exit")
    }
    exited = true
    const leftovers = readdirSync(run.root).filter((name) => name.startsWith("senpi-rpc-host-internal-"))
    if (leftovers.length > 0) errors.push(new Error(`task host left ${leftovers.join(", ")} behind`))
  } catch (error) {
    errors.push(error)
  } finally {
    if (exited) rmSync(run.root, { recursive: true, force: true })
    run.restore()
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, "packaged reload cleanup failed")
}
