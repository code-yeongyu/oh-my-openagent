import type { FingerprintProfile } from "../fingerprint-types"
import type { ProviderCredentials } from "../provider-types"

export type { FingerprintProfile, ProviderCredentials }

export type ProbeErrorKind =
  | "connection_refused"
  | "timeout"
  | "dns_failure"
  | "tls_error"
  | "http_error"
  | "rate_limited"
  | "blocked"
  | "captcha"
  | "unknown"

export type ProbeError = {
  kind: ProbeErrorKind
  message: string
  http_status?: number
  response_body_preview?: string
  retryable: boolean
}

export type ProbeRequest = {
  url: string
  method: string
  headers: Record<string, string>
  body?: string | Uint8Array
  timeout_ms: number
  fingerprint?: FingerprintProfile
  forward_as_is: boolean
  metadata: {
    session_id: string
    hypothesis_id?: string
    experiment_id?: string
    exchange_sequence: number
  }
}

export type ProbeTiming = {
  total_ms: number
  dns_ms?: number
  connect_ms?: number
  tls_ms?: number
  first_byte_ms?: number
}

export type ProviderIdentity = {
  id: string
  label: string
  kind: string
  tier: "canary" | "standard" | "premium" | "sacrificial"
  config: Record<string, string>
  status: string
  fingerprint_profile_id?: string
}

export type ProbeResponse = {
  status: number
  headers: Record<string, string>
  body: string
  timing: ProbeTiming
  identity_used: ProviderIdentity | null
  fingerprint_used: FingerprintProfile | null
  retry_count: number
  error?: ProbeError
}

export type HealthCheckResult = {
  ok: boolean
  status_code?: number
  message: string
  checked_at: number
}

export type CredentialRefreshResult = {
  success: boolean
  refresh_type: string
  new_expiry?: number
  message?: string
  new_value?: string
  new_value_field?: string
}

export type CredentialRotationResult = {
  success: boolean
  rotation_type: string
  new_value_hash?: string
}

export type IdentityPreference = {
  tier?: "canary" | "standard" | "premium" | "sacrificial"
  preferred_label?: string
}

export type IdentityOutcome = {
  success: boolean
  http_status?: number
  error_kind?: ProbeErrorKind
}

export type ProbeChunk = {
  data: string
  done: boolean
}

export type RateLimitConfig = {
  rps: number | null
  rpm: number | null
  tpm: number | null
  cooldown_on_429_s: number
}

export type ErrorTaxonomy = {
  rate_limited_signals: ReadonlyArray<string>
  blocked_signals: ReadonlyArray<string>
}

export interface ProbeProvider {
  readonly id: string
  readonly kind: string
  healthCheck(): Promise<HealthCheckResult>
  refreshCredentials(refreshType: string): Promise<CredentialRefreshResult>
  rotateCredentials(reason: string): Promise<CredentialRotationResult>
  dispatchProbe(request: ProbeRequest): Promise<ProbeResponse>
  getRateLimits(): RateLimitConfig
  getErrorTaxonomy(): ErrorTaxonomy
  getSupportedModels(): ReadonlyArray<string>
}
