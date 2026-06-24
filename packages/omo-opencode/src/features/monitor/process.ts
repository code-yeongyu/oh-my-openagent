import { tokenizeCommand } from "../../tools/interactive-bash/tools"

export type TimerHandle = ReturnType<typeof setTimeout> | number

export interface SpawnDeps {
  spawn?: typeof Bun.spawn
  setTimer: (fn: () => void, ms: number) => TimerHandle
  clearTimer: (handle: TimerHandle) => void
}

export interface MonitoredProcess {
  kill(signal?: NodeJS.Signals): void
  exited: Promise<{ code: number | null; signal: string | null }>
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
}

type PipeSubprocess = Bun.Subprocess<"ignore", "pipe", "pipe">
type ExitResult = { code: number | null; signal: string | null }

const KILL_GRACE_MS = 5_000

function killProcessGroup(pid: number, signal: NodeJS.Signals | 0): void {
  try {
    process.kill(-pid, signal)
  } catch (error) {
    void error
  }
}

function spawnDetachedProcess(
  argv: string[],
  opts: { cwd?: string; env?: Record<string, string> },
  spawn: typeof Bun.spawn,
): PipeSubprocess {
  return spawn<"ignore", "pipe", "pipe">(argv, {
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

  const subprocess = spawnDetachedProcess(argv, opts, deps.spawn ?? Bun.spawn)
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

    killProcessGroup(subprocess.pid, signal)
    if (graceTimer === undefined) {
      graceTimer = deps.setTimer(() => {
        if (!actualExited) {
          killProcessGroup(subprocess.pid, "SIGKILL")
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
    settlePublicExit({ code, signal: subprocess.signalCode })
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
