import { spawn, type SpawnOptions } from "node:child_process"

export interface TestFastGroup {
  readonly name: string
  readonly args: readonly string[]
}

export type SpawnTestGroup = (group: TestFastGroup) => Promise<number>

/** Injected so unit tests capture progress lines instead of printing production output. */
export type LogLine = (line: string) => void

/** Marker exported to every spawned group so a nested run refuses to recurse. */
export const REENTRY_ENV_VAR = "OMO_TEST_FAST_ACTIVE"

export function isReentry(env: Readonly<Record<string, string | undefined>>): boolean {
  return (env[REENTRY_ENV_VAR] ?? "") !== ""
}

export function childEnv(
  parent: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  return { ...parent, [REENTRY_ENV_VAR]: "1" }
}

export function testFastGroups(): TestFastGroup[] {
  return [
    {
      name: "opencode-memory",
      args: ["test", "packages/omo-opencode", "packages/memory-core"],
    },
    { name: "root-rest", args: ["--config=bunfig.win2.toml", "test"] },
    { name: "senpi", args: ["test", "packages/omo-senpi"] },
  ]
}

/** Minimal view of a spawned child the registry needs; keeps fakes cheap in tests. */
export interface ChildHandle {
  readonly pid?: number | undefined
  kill(signal: NodeJS.Signals): boolean
}

export type KillProcessGroup = (negatedPid: number, signal: NodeJS.Signals) => void

export interface ChildRegistry {
  add(child: ChildHandle): void
  remove(child: ChildHandle): void
  hasSignalTargets(): boolean
  killAll(signal: NodeJS.Signals, kill: KillProcessGroup): void
}

const SIGNAL_NUMBERS = { SIGINT: 2, SIGTERM: 15 } as const
export type TerminationSignal = keyof typeof SIGNAL_NUMBERS

const isErrnoException = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error && typeof error.code === "string"

export function signalExitCode(signal: TerminationSignal): number {
  return 128 + SIGNAL_NUMBERS[signal]
}

const SHUTDOWN_GRACE_MS = 5_000

/**
 * Forwards the parent's termination signal to every group, waits out a grace
 * period, then SIGKILLs whatever is still running. Escalation keys off the
 * registry's retained signal targets, not leader liveness: a POSIX group leader
 * routinely exits while a descendant that swallowed SIGTERM keeps draining, and
 * that descendant is exactly the orphan this guards against.
 */
export async function shutdownChildren(
  registry: ChildRegistry,
  signal: TerminationSignal,
  kill: KillProcessGroup,
  waitGrace: () => Promise<void> = () =>
    new Promise((resolve) => void setTimeout(resolve, SHUTDOWN_GRACE_MS)),
): Promise<void> {
  registry.killAll(signal, kill)
  await waitGrace()
  if (registry.hasSignalTargets()) registry.killAll("SIGKILL", kill)
}

/**
 * Tracks group children so a parent signal takes the whole tree down with it.
 * POSIX children are spawned detached, so signalling `-pid` reaches the bun
 * process AND everything it spawned. The PGID is retained past the leader's
 * exit because the group outlives its leader; dropping it there is what lets a
 * SIGTERM-ignoring descendant escape the SIGKILL escalation. win32 has no
 * process groups, so only the live handle can kill itself.
 */
export function createChildRegistry(platform: NodeJS.Platform): ChildRegistry {
  const live = new Set<ChildHandle>()
  const retainedGroups = new Set<number>()
  const isPosix = platform !== "win32"
  return {
    add: (child) => {
      live.add(child)
      if (isPosix && child.pid !== undefined) retainedGroups.add(child.pid)
    },
    remove: (child) => void live.delete(child),
    hasSignalTargets: () => (isPosix ? retainedGroups.size > 0 : live.size > 0),
    killAll: (signal, kill) => {
      if (!isPosix) {
        for (const child of live) if (child.pid !== undefined) child.kill(signal)
        return
      }
      for (const pid of retainedGroups) {
        try {
          kill(-pid, signal)
        } catch (error) {
          // The group raced us to exit; nothing left to signal.
          if (!isErrnoException(error) || error.code !== "ESRCH") throw error
        }
      }
    },
  }
}

/** The spawn contract this script depends on; the seam unit tests substitute. */
export type SpawnGroupOptions = SpawnOptions

/** The two lifecycle events this script subscribes to, with their payloads. */
export interface ChildLifecycleEvents {
  readonly error: Error
  readonly exit: number | null
}

export interface SpawnedChild extends ChildHandle {
  once<E extends keyof ChildLifecycleEvents>(
    event: E,
    listener: (payload: ChildLifecycleEvents[E]) => void,
  ): unknown
}

export type SpawnChildProcess = (
  command: string,
  args: readonly string[],
  options: SpawnGroupOptions,
) => SpawnedChild

/** Selects node's three-argument overload; the bare `spawn` symbol carries a
 * two-argument overload that is not assignable to the seam. */
const spawnChildProcess: SpawnChildProcess = (command, args, options) =>
  spawn(command, args, options)

/**
 * Every group child inherits the parent's stdio, carries the re-entry marker so
 * a nested run refuses to recurse, and is detached on POSIX so the registry can
 * signal its whole process group. All three are load-bearing, so the spawn call
 * is injectable and asserted rather than trusted.
 */
export function spawnInheritingStdio(
  registry: ChildRegistry,
  log: LogLine,
  spawnChild: SpawnChildProcess = spawnChildProcess,
): SpawnTestGroup {
  return (group) =>
    new Promise((resolve, reject) => {
      const child = spawnChild(process.execPath, group.args, {
        stdio: "inherit",
        env: childEnv(process.env),
        detached: process.platform !== "win32",
      })
      registry.add(child)
      child.once("error", (error) => {
        registry.remove(child)
        reject(error)
      })
      child.once("exit", (code) => {
        registry.remove(child)
        log(`[test-fast] ${group.name}: exit ${code ?? 1}`)
        resolve(code ?? 1)
      })
    })
}

/**
 * Runs every group in parallel. A rejected group (a failed spawn) aborts the
 * `Promise.all` while its detached siblings are still running, so the failure
 * path shuts the survivors down before the error propagates and the parent
 * exits; otherwise those siblings outlive the run as orphans.
 */
export async function runTestFast(
  spawnGroup: SpawnTestGroup,
  log: LogLine = console.log,
  shutdownSurvivors: () => void | Promise<void> = () => {},
): Promise<number> {
  const groups = testFastGroups()
  log(
    `[test-fast] running ${groups.length} groups in parallel: ${groups
      .map((group) => group.name)
      .join(", ")}`,
  )
  try {
    const exits = await Promise.all(groups.map(spawnGroup))
    return exits.every((exit) => exit === 0) ? 0 : 1
  } catch (error) {
    await shutdownSurvivors()
    throw error
  }
}

if (import.meta.main) {
  if (isReentry(process.env)) {
    console.error(
      `[test-fast] re-entry blocked: ${REENTRY_ENV_VAR} is set; refusing to recurse`,
    )
    process.exit(1)
  }
  const registry = createChildRegistry(process.platform)
  const killGroup: KillProcessGroup = (pid, forwarded) => void process.kill(pid, forwarded)
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      console.error(`[test-fast] ${signal} received: terminating group children`)
      void shutdownChildren(registry, signal, killGroup).then(() =>
        process.exit(signalExitCode(signal)),
      )
    })
  }
  process.exitCode = await runTestFast(
    spawnInheritingStdio(registry, console.log),
    console.log,
    () => {
      console.error("[test-fast] group failed to start: terminating surviving groups")
      return shutdownChildren(registry, "SIGTERM", killGroup)
    },
  )
}
