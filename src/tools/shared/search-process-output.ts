import type { SpawnedProcess } from "../../shared/bun-spawn-shim"
import { readProcessStream } from "../../shared/process-stream-reader"

export interface SearchProcessOutput {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function createProcessTimeout(
  proc: SpawnedProcess,
  timeoutMs: number,
  timeoutMessage: string
): Promise<never> {
  return new Promise<never>((_, reject) => {
    const id = setTimeout(() => {
      proc.kill()
      reject(new Error(timeoutMessage))
    }, timeoutMs)

    // #3919: Handle rejected exits here so timeout cleanup cannot leak unhandled rejections.
    void proc.exited.then(
      () => clearTimeout(id),
      () => clearTimeout(id)
    )
  })
}

export async function collectSearchProcessOutput(
  proc: SpawnedProcess,
  timeoutMs: number,
  timeoutMessage: string
): Promise<SearchProcessOutput> {
  const stderrPromise = readProcessStream(proc.stderr).catch(getErrorMessage)
  const stdout = await Promise.race([
    readProcessStream(proc.stdout),
    createProcessTimeout(proc, timeoutMs, timeoutMessage),
  ])
  const [exitCode, stderr] = await Promise.all([proc.exited, stderrPromise])

  return { stdout, stderr, exitCode }
}
