import type { SpawnOptions } from "../../shared/spawn-with-windows-hide"
import { spawnWithWindowsHide } from "../../shared/spawn-with-windows-hide"

const DEFAULT_SPAWN_TIMEOUT_MS = 10_000

export async function spawnWithTimeout(
  command: string[],
  options: SpawnOptions,
  timeoutMs: number = DEFAULT_SPAWN_TIMEOUT_MS
): Promise<{ stdout: string; exitCode: number; timedOut: boolean }> {
  let proc: ReturnType<typeof spawnWithWindowsHide>
  try {
    proc = spawnWithWindowsHide(command, options)
  } catch {
    return { stdout: "", exitCode: 1, timedOut: false }
  }

  const timeoutPromise = new Promise<"timeout">((resolve) => {
    setTimeout(() => resolve("timeout"), timeoutMs)
  })

  const processPromise = (async (): Promise<"done"> => {
    await proc.exited
    return "done"
  })()

  const race = await Promise.race([processPromise, timeoutPromise])

  if (race === "timeout") {
    proc.kill("SIGTERM")
    return { stdout: "", exitCode: 1, timedOut: true }
  }

  const stdout = proc.stdout ? await new Response(proc.stdout).text() : ""
  return { stdout, exitCode: proc.exitCode ?? 1, timedOut: false }
}
