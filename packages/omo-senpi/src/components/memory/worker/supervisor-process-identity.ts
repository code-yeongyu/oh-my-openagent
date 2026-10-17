import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { readdirSync, watch, writeFileSync } from "@oh-my-opencode/memory-core/fs"
import { getProcessStartIdentity } from "@oh-my-opencode/memory-core/process-identity"

export type SupervisorRuntimePlatform = "posix" | "win32"
export type CancelSupervisorDeadline = () => void
export interface SupervisorChildExit {
  readonly code: number | null
  readonly signal: string | null
}

export function parseSupervisorChildExit(text: string): SupervisorChildExit | undefined {
  const line = text.trim().split("\n").at(-1)
  if (line === undefined || line.length === 0) return undefined
  try {
    const value = JSON.parse(line) as Record<string, unknown>
    const code = typeof value.code === "number" || value.code === null ? value.code : undefined
    const signal = typeof value.signal === "string" || value.signal === null ? value.signal : undefined
    return code === undefined || signal === undefined || signal === "MODEL_PID" ? undefined : { code, signal }
  } catch {
    return undefined
  }
}

function testSeamsEnabled(): boolean {
  return process.env.OMO_MEMORY_SUPERVISOR_ALLOW_TEST_SEAMS === "1"
}

export function getSupervisorRuntimePlatform(): SupervisorRuntimePlatform {
  if (testSeamsEnabled()) {
    const injected = process.env.OMO_MEMORY_SUPERVISOR_PLATFORM
    if (injected === "posix" || injected === "win32") return injected
  }
  return process.platform === "win32" ? "win32" : "posix"
}

/** Current instant from the active clock source: the injected seam clock under test seams,
 * else wall time. NaN when a seam clock is active but unreadable. */
export function readSupervisorClockNow(): number {
  const clockDir = testSeamsEnabled() ? process.env.OMO_MEMORY_SUPERVISOR_CLOCK_PATH : undefined
  if (clockDir === undefined) return Date.now()
  return readInjectedClock(clockDir)
}

export function scheduleSupervisorDeadline(instant: number, callback: () => void): CancelSupervisorDeadline {
  const clockDir = testSeamsEnabled() ? process.env.OMO_MEMORY_SUPERVISOR_CLOCK_PATH : undefined
  if (clockDir === undefined) {
    const timer = setTimeout(callback, Math.max(0, instant - Date.now()))
    return () => clearTimeout(timer)
  }
  let settled = false
  const check = () => {
    if (settled) return
    const now = readInjectedClock(clockDir)
    if (!Number.isFinite(now) || now < instant) return
    settled = true
    watcher?.close()
    clearInterval(safety)
    callback()
  }
  if (readInjectedClock(clockDir) >= instant) {
    settled = true
    callback()
    return () => {}
  }
  const watcher = watch(clockDir, check)
  // `check` bails whenever the directory read does not yet yield a finite instant, and the tick
  // that crosses the deadline is normally the last write here - so that bail is permanent: no
  // further event ever arrives to retry it and the deadline never fires. Re-reading on an interval
  // makes arrival depend on the clock's VALUE rather than on one directory read happening to
  // observe it, which measured 3/60 failures against 11/60 for edges alone on Linux.
  const safety = setInterval(check, CLOCK_RECHECK_INTERVAL_MS)
  check()
  return () => {
    if (settled) return
    settled = true
    watcher.close()
    clearInterval(safety)
  }
}

const CLOCK_RECHECK_INTERVAL_MS = 25

function readInjectedClock(clockDir: string): number {
  const latest = readdirSync(clockDir)
    .map((name) => /^(\d+)-(-?\d+(?:\.\d+)?)$/.exec(name))
    .filter((match): match is RegExpExecArray => match !== null)
    .sort((left, right) => Number(left[1]) - Number(right[1]))
    .at(-1)
  return latest === undefined ? Number.NaN : Number(latest[2])
}

function recordTestTermination(action: string, targetPid: number): void {
  if (!testSeamsEnabled()) return
  const runDir = process.env.OMO_MEMORY_SUPERVISOR_TASKKILL_RUN_DIR
  if (runDir === undefined) return
  writeFileSync(`${runDir}/${action}-${process.pid}.json`, `${JSON.stringify({ targetPid })}\n`, "utf8")
}

function testCommand(name: string): readonly string[] | undefined {
  if (!testSeamsEnabled()) return undefined
  const raw = process.env[name]
  if (raw === undefined) return undefined
  const value = JSON.parse(raw) as unknown
  if (!Array.isArray(value) || !value.every((part) => typeof part === "string") || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string array`)
  }
  return value
}

function spawnTerminationCommand(command: readonly string[], args: readonly string[], synchronous: boolean): void {
  const [executable, ...prefix] = command
  if (executable === undefined) throw new TypeError("termination command is required")
  // taskkill runs from the console-less supervisor, so both forms need the same hidden creation flag.
  // Containment from `process.once("exit")` blocks: that handler cannot await, and an async child's
  // "error" event is queued on a loop that never turns again, so a taskkill that could not even be
  // spawned would leave the child tree alive with nothing written anywhere. Every other caller runs
  // on a live loop and stays async, so the supervisor never blocks on a termination child.
  if (synchronous) {
    const result = spawnSync(executable, [...prefix, ...args], {
      env: process.env,
      stdio: "ignore",
      windowsHide: true,
    })
    if (result.error !== undefined) throw result.error
    return
  }
  const child = spawn(executable, [...prefix, ...args], {
    env: process.env,
    stdio: "ignore",
    windowsHide: true,
  })
  child.once("error", (error) => process.stderr.write(`${error.message}\n`))
}

export function signalSupervisorProcessGroup(pid: number, signal: NodeJS.Signals): void {
  recordTestTermination(`posix-${signal}`, pid)
  const injected = testCommand("OMO_MEMORY_SUPERVISOR_POSIX_SIGNAL_COMMAND")
  if (injected !== undefined) {
    spawnTerminationCommand(injected, ["--signal-group", String(pid), signal], false)
    return
  }
  try {
    process.kill(-pid, signal)
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error
  }
}

function taskkillTree(pid: number, synchronous: boolean): void {
  const command = testCommand("OMO_MEMORY_SUPERVISOR_TASKKILL_COMMAND") ?? ["taskkill"]
  spawnTerminationCommand(command, ["/pid", String(pid), "/T", "/F"], synchronous)
}

export function recordSupervisorGracefulDeadline(pid: number | undefined): void {
  if (pid !== undefined) recordTestTermination("win32-graceful", pid)
}

export function terminateSupervisorChildGracefully(
  platform: SupervisorRuntimePlatform,
  wrapper: ChildProcess,
): void {
  if (platform === "win32") {
    recordSupervisorGracefulDeadline(wrapper.pid)
    wrapper.kill()
  } else if (wrapper.pid !== undefined) signalSupervisorProcessGroup(wrapper.pid, "SIGTERM")
}

export function terminateSupervisorChildHard(
  platform: SupervisorRuntimePlatform,
  pid: number | undefined,
  synchronous = false,
): void {
  if (pid === undefined) return
  if (platform === "win32") taskkillTree(pid, synchronous)
  else signalSupervisorProcessGroup(pid, "SIGKILL")
}

/**
 * The supervisor writes the start identities the parent later compares against its own reading,
 * so both sides must go through the one memory-core reader: a supervisor-local `ps -o lstart`
 * scheme against the parent's libproc scheme made every live run look reused (#8304).
 * Win32 used to return null because the PowerShell probe was too slow to trust; kernel32
 * GetProcessTimes now answers in-process (#8294), so every platform uses the same reader.
 * A dead pid still returns null from memory-core and classifies as dead; an unreadable
 * identity still classifies as unknown.
 */
export async function getSupervisorProcessStart(pid: number): Promise<string | null> {
  return await getProcessStartIdentity(pid)
}
