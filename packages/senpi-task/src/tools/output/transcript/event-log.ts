import { readFileSync } from "node:fs"
import { join } from "node:path"

import { TRANSCRIPT_ASSISTANT_EVENT, TRANSCRIPT_TOOL_EVENT } from "../../../manager/transcript-log"
import type { TranscriptEntry } from "../types"

// Re-exported from the writer (manager/transcript-log.ts) so reader and writer share ONE contract for
// the event-type names and can never drift.
export { TRANSCRIPT_ASSISTANT_EVENT, TRANSCRIPT_TOOL_EVENT }

// Reconstruct a child's transcript from OUR event log (logs/<taskId>.jsonl). Only the two transcript
// event types are lifted; lifecycle/audit events on the same log are ignored. A missing log is an
// empty transcript, never a throw (task_output is read-only and must tolerate absent state).
export function readEventLogTranscript(stateDir: string, taskId: string): readonly TranscriptEntry[] {
  const raw = readLog(join(stateDir, "logs", `${taskId}.jsonl`))
  if (raw === undefined) return []
  const entries: TranscriptEntry[] = []
  for (const line of raw.split("\n")) {
    const entry = transcriptEntryOf(parseLine(line))
    if (entry !== undefined) entries.push(entry)
  }
  return entries
}

function readLog(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
    throw error
  }
}

function parseLine(line: string): unknown {
  const trimmed = line.trim()
  if (trimmed.length === 0) return undefined
  try {
    return JSON.parse(trimmed)
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
}

function transcriptEntryOf(entry: unknown): TranscriptEntry | undefined {
  if (!isRecord(entry)) return undefined
  const payload = entry.payload
  if (!isRecord(payload)) return undefined
  if (entry.type === TRANSCRIPT_ASSISTANT_EVENT && typeof payload.text === "string") {
    return { kind: "assistant", text: payload.text }
  }
  if (entry.type === TRANSCRIPT_TOOL_EVENT && typeof payload.tool === "string") {
    return { kind: "tool", tool: payload.tool, is_error: payload.is_error === true }
  }
  if (entry.type === "team_message_waited" && typeof payload.from === "string" && typeof payload.body === "string") {
    return { kind: "assistant", text: `[team message from ${payload.from}] ${payload.body}` }
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
