import type { ComponentLogger, SenpiExtensionAPI } from "../../extension/types"

interface WakeSourceChannel {
  readonly id: string
  readonly description: string
  readonly startedAtMs: number
}

interface ErrorWithCode {
  readonly code: unknown
}

const STORAGE_EXHAUSTION_CODES: ReadonlySet<string> = new Set(["ENOSPC", "EDQUOT"])

export function publishWakeSourceState(
  pi: SenpiExtensionAPI,
  logger: Pick<ComponentLogger, "warn">,
  source: string,
  channels: readonly WakeSourceChannel[],
): boolean {
  try {
    pi.events?.emit("wake_source_state", {
      source,
      activeCount: channels.length,
      channels,
    })
    return true
  } catch (error) {
    if (!isStorageExhaustionError(error)) throw error
    logger.warn("omo-senpi wake-source publication skipped: storage exhausted in event listener", {
      source,
      code: error.code,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

function isStorageExhaustionError(error: unknown): error is ErrorWithCode {
  if (typeof error !== "object" || error === null || !("code" in error)) return false
  return typeof error.code === "string" && STORAGE_EXHAUSTION_CODES.has(error.code)
}
