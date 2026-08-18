import { spawnSync } from "node:child_process"

interface TaskkillResult {
  status: number | null
  signal?: NodeJS.Signals | null
  error?: Error
}

export interface ProcessGroupRuntime {
  platform: NodeJS.Platform
  runTaskkill(pid: number): TaskkillResult
  killGroup(pid: number): void
  probeGroup(pid: number): void
}

const defaultRuntime: ProcessGroupRuntime = {
  platform: process.platform,
  runTaskkill: (pid) => {
    const result = spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
    })
    return {
      status: result.status,
      signal: result.signal,
      error: result.error,
    }
  },
  killGroup: (pid) => process.kill(-pid, "SIGKILL"),
  probeGroup: (pid) =>
    process.kill(process.platform === "win32" ? pid : -pid, 0),
}

export function validateProcessGroupPid(pid: number): number {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new RangeError(`process-group pid must be a positive integer: ${pid}`)
  }
  return pid
}

export function terminateProcessGroup(
  pid: number,
  runtime: ProcessGroupRuntime = defaultRuntime,
): void {
  const validatedPid = validateProcessGroupPid(pid)
  if (runtime.platform !== "win32") {
    runtime.killGroup(validatedPid)
    return
  }
  const result = runtime.runTaskkill(validatedPid)
  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = result.signal
      ? `signal ${result.signal}`
      : `exit code ${String(result.status)}`
    throw new Error(`taskkill failed with ${detail}`)
  }
}

export function processGroupIsAlive(
  pid: number,
  runtime: ProcessGroupRuntime = defaultRuntime,
): boolean {
  const validatedPid = validateProcessGroupPid(pid)
  try {
    runtime.probeGroup(validatedPid)
    return true
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM"
  }
}
