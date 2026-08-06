import type { TranscriptReadResult, TranscriptReader } from "../types"
import { readEventLogTranscript } from "./event-log"
import { readSessionDirTranscript } from "./session-dir"

// The default transcript source resolution: OUR in-process event log first (authoritative for
// in-process children we instrumented), falling back to the rpc child's own persisted session JSONL.
// Reports which source answered so task_output can surface it. Never throws on absent state.
export const defaultTranscriptReader: TranscriptReader = ({ taskId, stateDir }): TranscriptReadResult => {
  const eventLog = readEventLogTranscript(stateDir, taskId)
  if (eventLog.length > 0) return { entries: eventLog, source: "event-log" }

  const session = readSessionDirTranscript(stateDir, taskId)
  if (session.length > 0) return { entries: session, source: "session-jsonl" }

  return { entries: [], source: "none" }
}
