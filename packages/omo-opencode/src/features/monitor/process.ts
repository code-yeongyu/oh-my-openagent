import { tokenizeCommand } from "../../tools/interactive-bash/tools"
import { spawn as runtimeSpawn } from "../../shared/bun-spawn-shim"

export type TimerHandle = ReturnType<typeof setTimeout> | number

export interface SpawnDeps {
  spawn?: SpawnFunction
  setTimer: (fn: () => void, ms: number) => TimerHandle
  clearTimer: (handle: TimerHandle) => void
}

export interface MonitoredProcess {
  kill(signal?: NodeJS.Signals): void
  exited: Promise<{ code: number | null; signal: string | null }>
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
}

type ExitResult = { code: number | null; signal: string | null }
interface SpawnedMonitorProcess {
  readonly exited: Promise<number>
  readonly stdout: ReadableStream<Uint8Array>
  readonly stderr: ReadableStream<Uint8Array>
  readonly pid?: number
  readonly signalCode?: NodeJS.Signals | null
}

type SpawnFunction = (argv: readonly string[], options: {
  readonly cwd?: string
  readonly env?: Record<string, string>
  readonly detached: boolean
  readonly stdin: "ignore"
  readonly stdout: "pipe"
  readonly stderr: "pipe"
}) => SpawnedMonitorProcess

const KILL_GRACE_MS = 5_000

function killProcessGroup(pid: number, signal: NodeJS.Signals | 0): void {
  try {
    process.kill(-pid, signal)
  } catch (error) {
    void error
  }
}

function spawnDetachedProcess(
  argv: readonly string[],
  opts: { cwd?: string; env?: Record<string, string> },
  spawn: SpawnFunction,
): SpawnedMonitorProcess {
  return spawn(argv, {
    cwd: opts.cwd,
    env: opts.env,
    detached: true,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
}

export function spawnMonitoredProcess(
  opts: { command: string; cwd?: string; env?: Record<string, string>; maxRuntimeMs: number },
  deps: SpawnDeps,
): MonitoredProcess {
  const argv = tokenizeCommand(opts.command)
  if (argv.length === 0) {
    throw new Error("Cannot spawn an empty monitor command")
  }

  const subprocess = spawnDetachedProcess(argv, opts, deps.spawn ?? runtimeSpawn)
  let actualExited = false
  let publicExitSettled = false
  let watchdogTimer: TimerHandle | undefined
  let graceTimer: TimerHandle | undefined
  let resolvePublicExit: (result: ExitResult) => void = () => {}

  const publicExit = new Promise<ExitResult>((resolve) => {
    resolvePublicExit = resolve
  })

  function clearWatchdog(): void {
    if (watchdogTimer !== undefined) {
      deps.clearTimer(watchdogTimer)
      watchdogTimer = undefined
    }
  }

  function clearGraceTimer(): void {
    if (graceTimer !== undefined) {
      deps.clearTimer(graceTimer)
      graceTimer = undefined
    }
  }

  function settlePublicExit(result: ExitResult): void {
    if (publicExitSettled) return
    publicExitSettled = true
    resolvePublicExit(result)
  }

  function kill(signal: NodeJS.Signals = "SIGTERM"): void {
    if (actualExited) return

    if (subprocess.pid !== undefined) {
      killProcessGroup(subprocess.pid, signal)
    }
    if (graceTimer === undefined) {
      graceTimer = deps.setTimer(() => {
        if (!actualExited) {
          if (subprocess.pid !== undefined) {
            killProcessGroup(subprocess.pid, "SIGKILL")
          }
        }
      }, KILL_GRACE_MS)
    }
  }

  watchdogTimer = deps.setTimer(() => {
    clearWatchdog()
    kill("SIGTERM")
    settlePublicExit({ code: null, signal: "SIGALRM" })
  }, opts.maxRuntimeMs)

  subprocess.exited.then((code) => {
    actualExited = true
    clearWatchdog()
    clearGraceTimer()
    settlePublicExit({ code, signal: subprocess.signalCode ?? null })
  }).catch((error) => {
    void error
    actualExited = true
    clearWatchdog()
    clearGraceTimer()
    settlePublicExit({ code: null, signal: null })
  })

  return {
    kill,
    exited: publicExit,
    stdout: subprocess.stdout,
    stderr: subprocess.stderr,
  }
}
