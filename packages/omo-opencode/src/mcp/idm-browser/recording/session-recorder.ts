import { appendFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

const RECORDINGS_DIR = join(process.env.HOME || homedir(), "Library", "Caches", "idm", "sessions")

export type RecordedAction = {
  ts: number
  tool: string
  params: Record<string, unknown>
  sessionId: string
  durationMs: number
  success: boolean
  resultSummary?: unknown
  error?: string
  recordingDir?: string
}

let recordingsDirReady = false

function ensureDir(): void {
  if (recordingsDirReady) return
  try {
    mkdirSync(RECORDINGS_DIR, { recursive: true })
    recordingsDirReady = true
  } catch {
    void 0
  }
}

export function recordAction(action: RecordedAction): void {
  if (!action.sessionId) return
  ensureDir()
  try {
    const file = action.recordingDir 
      ? join(action.recordingDir, "session.jsonl")
      : join(RECORDINGS_DIR, `${action.sessionId}.jsonl`)
    appendFileSync(file, JSON.stringify(action) + "\n")
  } catch {
    void 0
  }
}

export function getRecordingPath(sessionId: string): string {
  return join(RECORDINGS_DIR, `${sessionId}.jsonl`)
}
