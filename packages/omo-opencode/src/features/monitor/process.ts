import { join } from "node:path"

import { tokenizeCommand } from "../../tools/interactive-bash/tools"
import { spawn as runtimeSpawn } from "../../shared/bun-spawn-shim"

export type TimerHandle = ReturnType<typeof setTimeout> | number

export interface SpawnDeps {
  spawn?: SpawnFunction
  killProcessTree?: (pid: number) => void
  platform?: NodeJS.Platform
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

// Windows has no process groups, so process.kill(-pid) is rejected and the empty catch turns every
// kill into a no-op. The child is spawned detached, so nothing else reaps it: a watchdog timeout
// reports SIGALRM while the process keeps running. taskkill /T is what takes the tree down, the way
// execute-hook-command already does it, addressed through SystemRoot because PATH can lack
// System32 (#6738).
function killWindowsProcessTree(pid: number): void {
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? "C:\\Windows"
  const taskkill = join(systemRoot, "System32", "taskkill.exe")
  runtimeSpawn([taskkill, "/PID", String(pid), "/T", "/F"], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  })
}

function killProcessGroup(pid: number, signal: NodeJS.Signals | 0, platform: NodeJS.Platform, killTree: (pid: number) => void): void {
  try {
    if (platform === "win32") {
      if (signal === 0) {
        process.kill(pid, 0)
        return
      }
      killTree(pid)
      return
    }
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
      killProcessGroup(subprocess.pid, signal, deps.platform ?? process.platform, deps.killProcessTree ?? killWindowsProcessTree)
    }
    if (graceTimer === undefined) {
      graceTimer = deps.setTimer(() => {
        if (!actualExited) {
          if (subprocess.pid !== undefined) {
            killProcessGroup(subprocess.pid, "SIGKILL", deps.platform ?? process.platform, deps.killProcessTree ?? killWindowsProcessTree)
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
