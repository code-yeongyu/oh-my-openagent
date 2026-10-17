import { spawn } from "node:child_process"

interface TaskkillResult {
  status: number | null
  signal?: NodeJS.Signals | null
  error?: Error
}

export interface ProcessGroupRuntime {
  platform: NodeJS.Platform
  runTaskkill(pid: number): Promise<TaskkillResult>
  killGroup(pid: number): void
  probeGroup(pid: number): void
}

const defaultRuntime: ProcessGroupRuntime = {
  platform: process.platform,
  runTaskkill: async (pid) => {
    return await new Promise<TaskkillResult>((resolve) => {
      const child = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      })
      let resolved = false
      child.once("error", (error) => {
        if (!resolved) {
          resolved = true
          resolve({ status: null, error })
        }
      })
      child.once("exit", (status, signal) => {
        if (!resolved) {
          resolved = true
          resolve({ status, signal: signal as NodeJS.Signals | null })
        }
      })
    })
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

export async function terminateProcessGroup(
  pid: number,
  runtime: ProcessGroupRuntime = defaultRuntime,
): Promise<void> {
  const validatedPid = validateProcessGroupPid(pid)
  if (runtime.platform !== "win32") {
    runtime.killGroup(validatedPid)
    return
  }
  const result = await runtime.runTaskkill(validatedPid)
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
