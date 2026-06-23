export type PoolSnapshotTrigger = "manual" | "scheduled" | "experiment_start" | "experiment_end" | "alert"

export type PoolSnapshot = {
  id: string
  experiment_id: string | null
  session_id: string | null
  triggered_by: string
  snapshot_data: string
  total_identities: number | null
  active_count: number | null
  canary_count: number | null
  quarantined_count: number | null
  exhausted_count: number | null
  healthy_ratio: number | null
  created_at: number
}

export type NewPoolSnapshotInput = {
  id: string
  experiment_id?: string | null
  session_id?: string | null
  triggered_by: PoolSnapshotTrigger
  snapshot_data: unknown
  total_identities?: number | null
  active_count?: number | null
  canary_count?: number | null
  quarantined_count?: number | null
  exhausted_count?: number | null
  healthy_ratio?: number | null
}

export type CanaryLockAction = "lock" | "release" | "canary_test" | "promote" | "demote"

export type CanaryLock = {
  id: number
  identity_id: string
  locked_by: string
  lock_reason: string
  canary_test_url: string | null
  canary_test_expected_status: number
  canary_test_interval_s: number
  last_canary_test_at: number | null
  last_canary_result: string | null
  locked_at: number
  unlocked_at: number | null
}

export type NewCanaryLockInput = {
  identity_id: string
  locked_by: string
  lock_reason: string
  canary_test_url?: string | null
  canary_test_expected_status?: number
  canary_test_interval_s?: number
}

export type CaptureFormat = "jsonl" | "har" | "mitmproxy"

export type Capture = {
  id: string
  session_id: string
  format: string
  file_path: string
  file_size_bytes: number | null
  exchange_count: number | null
  compressed: number
  checksum_sha256: string | null
  created_at: number
}

export type NewCaptureInput = {
  id: string
  session_id: string
  format: CaptureFormat
  file_path: string
  file_size_bytes?: number | null
  exchange_count?: number | null
  compressed?: boolean
  checksum_sha256?: string | null
}
