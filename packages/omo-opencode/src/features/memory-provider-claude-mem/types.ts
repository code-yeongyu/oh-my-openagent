export interface ClaudeMemHealthResponse {
  status: "ok" | "error"
  version?: string
  worker_pid?: number
}

export interface ClaudeMemSearchParams {
  q: string
  limit?: number
  project?: string
  type?: string
  obs_type?: string
  date_start?: string
  date_end?: string
}

export interface ClaudeMemSearchItem {
  id: number
  time: string
  type: string
  title: string
  subtitle?: string
  project: string
  discovery_tokens?: number
}

export interface ClaudeMemSearchResponse {
  results: ClaudeMemSearchItem[]
  total: number
}

export interface ClaudeMemAddObservationRequest {
  session_id: string
  tool_name: string
  tool_input?: Record<string, unknown>
  tool_response?: string
  cwd?: string
}

export interface ClaudeMemWorkerConfig {
  baseUrl: string
  timeoutMs: number
  pidFilePath?: string
}

export interface SQLiteReaderConfig {
  dbPath: string
  readonlyMode: boolean
}

export interface ObservationRow {
  id: number
  memory_session_id: string
  project: string
  text: string | null
  type: string
  title: string | null
  subtitle: string | null
  facts: string | null
  narrative: string | null
  concepts: string | null
  files_read: string | null
  files_modified: string | null
  prompt_number: number | null
  discovery_tokens: number | null
  created_at: string
  content_hash: string | null
}

export interface SessionRow {
  id: number
  content_session_id: string
  memory_session_id: string | null
  project: string
  started_at: string
  completed_at: string | null
  status: string
  custom_title: string | null
}

export interface SessionSummaryRow {
  id?: number
  memory_session_id: string
  project: string
  summary_text?: string | null
  request?: string | null
  investigated?: string | null
  learned?: string | null
  completed?: string | null
  next_steps?: string | null
  files_read?: string | null
  files_edited?: string | null
  notes?: string | null
  prompt_number?: number | null
  discovery_tokens?: number | null
  created_at: string
  created_at_epoch?: number
}

export interface LostWriteRow {
  id: number
  tool_name: string | null
  status: string
  created_at: string
}
