import { mkdirSync, appendFileSync } from "node:fs"
import { join } from "node:path"

export type CompactionRecoveryPhase =
  | "rejected"
  | "rescue-applied"
  | "rescue-refused"
  | "rescue-unavailable"
  | "guidance-emitted"

export interface CompactionRecoveryRecord {
  phase: CompactionRecoveryPhase
  reason: string
  rejectionCause: string
  tokens: number | null
  contextWindow: number | null
  reserveTokens: number | null
  branchEntries: number | null
  detail?: string
}

export type AppendDiagnostics = (path: string, line: string) => void

function defaultAppend(path: string, line: string): void {
  appendFileSync(path, line)
}

/**
 * Best-effort persistent diagnosis for rejected required compactions (#6871 ask 1:
 * the engine surfaces the cause only in the TUI; nothing persisted it). One JSONL
 * line per record under `<agentHome>/logs/compaction-recovery.log`. Never throws.
 */
export function writeCompactionRecoveryDiagnostics(input: {
  agentHome: string | undefined
  record: CompactionRecoveryRecord
  now?: () => Date
  append?: AppendDiagnostics
}): void {
  const { agentHome, record } = input
  if (!agentHome) return
  const append = input.append ?? defaultAppend
  const logsDir = join(agentHome, "logs")
  const file = join(logsDir, "compaction-recovery.log")
  const ts = (input.now ?? (() => new Date()))().toISOString()
  const line = `${JSON.stringify({ ts, ...record })}\n`
  try {
    mkdirSync(logsDir, { recursive: true })
    append(file, line)
  } catch {
    // Diagnostics must never break the recovery path; the component logger already
    // captured the same record in-memory.
  }
}
