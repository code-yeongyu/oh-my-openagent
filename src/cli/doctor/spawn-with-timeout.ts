import type { SpawnOptions } from "../../shared/spawn-with-windows-hide"
import { spawnWithWindowsHide } from "../../shared/spawn-with-windows-hide"

const DEFAULT_SPAWN_TIMEOUT_MS = 10_000

export interface SpawnWithTimeoutResult {
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
}

async function readPipe(stream: ReadableStream<Uint8Array> | undefined): Promise<string> {
  if (!stream) {
    return ""
  }

  try {
    return await new Response(stream).text()
  } catch (error) {
    if (error instanceof TypeError && error.message.includes("already been used")) {
      return ""
    }
    throw error
  }
}

export async function spawnWithTimeout(
  command: string[],
  options: SpawnOptions,
  timeoutMs: number = DEFAULT_SPAWN_TIMEOUT_MS
): Promise<SpawnWithTimeoutResult> {
  let proc: ReturnType<typeof spawnWithWindowsHide>
  try {
    proc = spawnWithWindowsHide(command, options)
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }

    return { stdout: "", stderr: "", exitCode: 1, timedOut: false }
  }

  const stdoutPromise = readPipe(proc.stdout)
  const stderrPromise = readPipe(proc.stderr)
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
    await Promise.allSettled([stdoutPromise, stderrPromise])
    return { stdout: "", stderr: "", exitCode: 1, timedOut: true }
  }

  clearTimeout(timer)
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise])
  return { stdout, stderr, exitCode: proc.exitCode ?? 1, timedOut: false }
}
