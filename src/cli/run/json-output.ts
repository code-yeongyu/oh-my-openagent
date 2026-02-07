import type { RunResult } from "./types"

export interface JsonOutputManager {
  redirectToStderr: () => void
  restore: () => void
  emitResult: (result: RunResult) => void
}

interface JsonOutputManagerOptions {
  stdout?: NodeJS.WriteStream
  stderr?: NodeJS.WriteStream
}

export function createJsonOutputManager(
  options: JsonOutputManagerOptions = {}
): JsonOutputManager {
  const stdout = options.stdout ?? process.stdout
  const stderr = options.stderr ?? process.stderr

  const originalWrite = stdout.write.bind(stdout)

  function redirectToStderr(): void {
    stdout.write = function (chunk: string): boolean {
      return stderr.write(chunk)
    }
  }

  function restore(): void {
    stdout.write = originalWrite
  }

  function emitResult(result: RunResult): void {
    restore()
    originalWrite(JSON.stringify(result) + "\n")
  }

  return {
    redirectToStderr,
    restore,
    emitResult,
  }
}
