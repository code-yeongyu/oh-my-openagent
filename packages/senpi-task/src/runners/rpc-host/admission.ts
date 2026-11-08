import { RunnerError } from "../in-process/runner-error"
import { HostSessionOpenError, type OpenedHostSession } from "./session-client"

const HOST_MEMORY_PRESSURE = "host_memory_pressure"
const DEFAULT_PRESSURE_RETRY_MS = 30_000

export type HostAdmissionOptions = {
  readonly open: () => Promise<OpenedHostSession>
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
  readonly admissionWaitMs: number
  readonly onWarning: (message: string) => void | (() => void)
}

export async function openHostSessionWithAdmission(
  options: HostAdmissionOptions,
): Promise<OpenedHostSession> {
  const deadline = options.now() + options.admissionWaitMs
  let pressureNoted = false
  let clearPressureNote: (() => void) | undefined
  try {
    for (;;) {
      try {
        return await options.open()
      } catch (error) {
        const retryAfterMs = memoryPressureRetryMs(error)
        if (retryAfterMs === undefined || options.now() + retryAfterMs > deadline) throw error
        if (!pressureNoted) {
          pressureNoted = true
          const cleanup = options.onWarning(
            `${HOST_MEMORY_PRESSURE} - the daemon is above its memory watermark; waiting to start task children`,
          )
          if (cleanup !== undefined) clearPressureNote = cleanup
        }
        await options.sleep(retryAfterMs)
      }
    }
  } finally {
    clearPressureNote?.()
  }
}

function memoryPressureRetryMs(error: unknown): number | undefined {
  const cause = RunnerError.is(error) ? error.failure.cause : error
  if (!(cause instanceof HostSessionOpenError) || cause.code !== HOST_MEMORY_PRESSURE) return undefined
  return cause.retryAfterMs ?? DEFAULT_PRESSURE_RETRY_MS
}
