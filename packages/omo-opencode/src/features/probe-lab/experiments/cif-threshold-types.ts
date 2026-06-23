export type CifThresholdProbeOutcome = {
  size_chars: number
  exchange_id: number
  status: number
  ttft_ms: number | null
  total_ms: number
  sse_event_count: number
  data_chunk_count: number
  content_text: string
  content_chars: number
  token_usage: number | null
  terminal_status: string | null
  completed_normally: boolean
  empty_sse: boolean
  error_message: string | null
  body_preview: string
  chat_session_id: string | null
}

export type CifThresholdScanInput = {
  provider_id: string
  hypothesis_id: string
  sizes: ReadonlyArray<number>
  prompt_template?: string
  pace_ms?: number
  session_label_base?: string
  fresh_session_per_probe?: boolean
  abort_on_mute_check?: boolean
}

export type CifThresholdScanResult = {
  exchange_ids: number[]
  outcomes: CifThresholdProbeOutcome[]
  threshold_estimate: number | null
  behavior_changes_at: number | null
  aborted: boolean
  abort_reason: string | null
}
