import type { SpawnOptions } from "../../shared/spawn-with-windows-hide"
import { spawnWithWindowsHide } from "../../shared/spawn-with-windows-hide"

const DEFAULT_SPAWN_TIMEOUT_MS = 10_000

export interface SpawnWithTimeoutResult {
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
}

export async function spawnWithTimeout(
  command: string[],
  options: SpawnOptions,
  timeoutMs: number = DEFAULT_SPAWN_TIMEOUT_MS
): Promise<SpawnWithTimeoutResult> {
  let proc: ReturnType<typeof spawnWithWindowsHide>
  try {
    proc = spawnWithWindowsHide(command, options)
  } catch {
    return { stdout: "", stderr: "", exitCode: 1, timedOut: false }
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs)
  })

  const processPromise = (async (): Promise<"done"> => {
    await proc.exited
    return "done"
  })()

  const race = await Promise.race([processPromise, timeoutPromise])

  if (race === "timeout") {
    proc.kill("SIGTERM")
    await proc.exited.catch(() => {})
    return { stdout: "", stderr: "", exitCode: 1, timedOut: true }
  }

  clearTimeout(timer)
  const stdout = proc.stdout ? await new Response(proc.stdout).text() : ""
  const stderr = proc.stderr ? await new Response(proc.stderr).text() : ""
  return { stdout, stderr, exitCode: proc.exitCode ?? 1, timedOut: false }
}
