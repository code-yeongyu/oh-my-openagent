import type { ComponentLogger } from "../../extension/types"

export interface RecordedLogEntry {
  level: string
  message: string
  details?: unknown
}

export function createRecordingLogger(): ComponentLogger & { entries: RecordedLogEntry[] } {
  const entries: RecordedLogEntry[] = []
  return {
    entries,
    info(message, details) {
      entries.push({ level: "info", message, details })
    },
    warn(message, details) {
      entries.push({ level: "warn", message, details })
    },
    error(message, details) {
      entries.push({ level: "error", message, details })
    },
  }
}
