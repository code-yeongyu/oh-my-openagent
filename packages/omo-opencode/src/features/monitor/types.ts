export type MonitorId = string

export type MonitorMode = "idle" | "live_safe"
export type MonitorStatus = "starting" | "running" | "exited" | "stopped" | "failed"
export type OutputStreamType = "stdout" | "stderr"

export interface MonitorCounters {
  totalLines: number
  matchedLines: number
  unmatchedLines: number
  droppedMatched: number
  droppedUnmatched: number
  bytesDropped: number
  lastSequence: number
}

export interface OutputLine {
  stream: OutputStreamType
  seq: number
  text: string
  truncated?: boolean
}

export interface OutputBatch {
  monitorId: MonitorId
  batchSeq: number
  lines: OutputLine[]
  stillRunning: boolean
}

export interface MonitorRecord {
  id: MonitorId
  command: string
  label: string
  mode: MonitorMode
  parentSessionId: string
  startedAt: Date
  status: MonitorStatus
  exitCode?: number
  signal?: string
  counters: MonitorCounters
}

export interface MonitorManager {
  start(opts: MonitorStartOpts): Promise<MonitorRecord>
  stop(id: MonitorId): Promise<void>
  list(sessionId: string): MonitorRecord[]
  get(id: MonitorId): MonitorRecord | undefined
  getOutput(id: MonitorId, opts: MonitorOutputQuery): MonitorOutputResult
  stopSessionMonitors(sessionId: string): Promise<void>
  handleEvent(event: MonitorManagerEvent): void
  shutdown(): Promise<void>
}

export interface MonitorStartOpts {
  command: string
  label?: string
  mode?: MonitorMode
  matchPattern?: string
  parentSessionId: string
  parentMessageId?: string
}

export interface MonitorOutputQuery {
  stream?: "matched" | "unmatched" | "all"
  since_sequence?: number
  limit?: number
}

export interface MonitorOutputResult {
  lines: OutputLine[]
  counters: MonitorCounters
}

export type MonitorManagerEvent =
  | { type: "session.idle"; sessionId: string }
  | { type: "session.deleted"; sessionId: string }

export interface MonitorStartArgs {
  command: string
  label?: string
  mode?: MonitorMode
  match_pattern?: string
}

export interface MonitorOutputArgs {
  monitor_id: string
  stream?: "matched" | "unmatched" | "all"
  since_sequence?: number
  limit?: number
}
