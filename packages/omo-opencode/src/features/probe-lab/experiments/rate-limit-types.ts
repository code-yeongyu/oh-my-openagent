export type MuteState = {
  is_muted: 0 | 1
  mute_until: number | null
  sampled_at: number
  raw_status: number
  raw_body_preview: string
}

export type RateProbeOutcome = {
  index: number
  exchange_id: number
  status: number
  ttft_ms: number | null
  total_ms: number
  prompt_chars: number
  empty_sse: boolean
  terminal_status: string | null
  completed_normally: boolean
  error_message: string | null
  started_at: number
  chat_session_id: string | null
}

export type SustainedScanConfig = {
  req_per_min: number
  total_requests: number
  prompt_chars?: number
  prompt_template?: string
}

export type BurstScanConfig = {
  concurrency: number
  total_requests: number
  prompt_chars?: number
  prompt_template?: string
}

export type TokenVolumeScanConfig = {
  prompt_sizes: ReadonlyArray<number>
  count_per_size: number
  pace_ms?: number
  prompt_template?: string
}

export type RecoveryCurveConfig = {
  checkpoints_seconds: ReadonlyArray<number>
  baseline_mute_state?: MuteState
}

export type RateMuteEvent = {
  triggered_at: number
  mute_until_reported: number | null
  trigger_status: number
  trigger_body_preview: string
}

export type RecoverySample = {
  elapsed_seconds: number
  mute_state: MuteState
}

export type RateScanMode = "sustained" | "burst" | "token_volume" | "recovery"

export type RateScanInput = {
  provider_id: string
  hypothesis_id: string
  mode: RateScanMode
  sustained?: SustainedScanConfig
  burst?: BurstScanConfig
  token_volume?: TokenVolumeScanConfig
  recovery?: RecoveryCurveConfig
  mute_check_interval_ms?: number
  abort_on_mute?: boolean
  session_label_base?: string
}

export type RateScanSummary = {
  total_probes: number
  succeeded: number
  failed_or_blocked: number
  empty_sse: number
  average_ttft_ms: number | null
  elapsed_ms: number
}

export type RateScanResult = {
  mode: RateScanMode
  exchange_ids: number[]
  outcomes: RateProbeOutcome[]
  mute_samples: MuteState[]
  mute_event: RateMuteEvent | null
  recovery_samples: RecoverySample[]
  aborted: boolean
  abort_reason: string | null
  summary: RateScanSummary
}
