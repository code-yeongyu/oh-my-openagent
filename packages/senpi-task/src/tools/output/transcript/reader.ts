import type { TranscriptReadResult, TranscriptReader } from "../types"
import { readEventLogTranscriptResult } from "./event-log"
import { readSessionDirTranscriptResult } from "./session-dir"

// The default transcript source resolution: OUR in-process event log first (authoritative for
// in-process children we instrumented), falling back to the rpc child's own persisted session JSONL.
// Reports which source answered so task_output can surface it. Never throws on absent state.
export const defaultTranscriptReader: TranscriptReader = ({ taskId, stateDir }): TranscriptReadResult => {
  const eventLog = readEventLogTranscriptResult(stateDir, taskId)
  if (eventLog.entries.length > 0 || eventLog.truncated === true) return eventLog

  const session = readSessionDirTranscriptResult(stateDir, taskId)
  if (session.entries.length > 0 || session.truncated === true) return session

  return { entries: [], source: "none" }
}
