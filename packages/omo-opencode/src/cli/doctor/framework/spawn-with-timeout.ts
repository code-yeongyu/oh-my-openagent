import type { SpawnOptions } from "../../../shared/spawn-with-windows-hide"
import { spawnWithWindowsHide } from "../../../shared/spawn-with-windows-hide"

const DEFAULT_SPAWN_TIMEOUT_MS = 10_000
const MISSING_EXECUTABLE_ERROR_CODE = "ENOENT"

export interface SpawnWithTimeoutResult {
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
}

async function readSpawnStream(stream: ReadableStream<Uint8Array> | undefined): Promise<string> {
  if (!stream) {
    return ""
  }

  try {
    return await new Response(stream).text()
  } catch (error) {
    if (error instanceof Error && error.message.includes("already been used")) {
      return ""
    }
    throw error
  }
}

function isMissingExecutableError(error: Error): boolean {
  const code = "code" in error ? error.code : undefined
  return code === MISSING_EXECUTABLE_ERROR_CODE
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

    if (!isMissingExecutableError(error)) {
      throw error
    }

    return { stdout: "", stderr: "", exitCode: 1, timedOut: false }
  }

  const stdoutPromise = readSpawnStream(proc.stdout)
  const stderrPromise = readSpawnStream(proc.stderr)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs)
  })

  const processPromise = (async (): Promise<"done"> => {
    await proc.exited
    return "done"
  })()

  let race: "done" | "timeout"
  try {
    race = await Promise.race([processPromise, timeoutPromise])
  } catch (error) {
    clearTimeout(timer)
    await Promise.allSettled([stdoutPromise, stderrPromise])
    if (error instanceof Error && isMissingExecutableError(error)) {
      return { stdout: "", stderr: "", exitCode: 1, timedOut: false }
    }
    throw error
  }

  if (race === "timeout") {
    proc.kill("SIGTERM")
    await proc.exited.catch((error: unknown) => {
      if (error instanceof Error) {
        return
      }
      throw error
    })
    await Promise.allSettled([stdoutPromise, stderrPromise])
    return { stdout: "", stderr: "", exitCode: 1, timedOut: true }
  }

  clearTimeout(timer)
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise])
  return { stdout, stderr, exitCode: proc.exitCode ?? 1, timedOut: false }
}
