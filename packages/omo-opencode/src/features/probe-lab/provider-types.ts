export type ProviderType =
  | "openai_compatible"
  | "anthropic"
  | "google"
  | "custom_http"
  | "ds2api"
  | "openai_official"
  | "anthropic_official"
  | "deepseek_web"
  | "gemini_official"
  | "opencode_go"
  | "openrouter"
  | "ollama_local"
  | "claude_web_reverse"
  | "gemini_web_reverse"
  | "manus_web"
export type ProviderAuthType = "bearer_token" | "api_key_header" | "cookie_session" | "oauth2" | "none"
export type ProviderStatus = "active" | "degraded" | "down" | "exhausted"

export type ProviderCredentials = {
  id: string
  name: string
  provider_type: string
  base_url: string
  auth_type: string
  auth_config: string
  default_headers: string | null
  rate_limit_rps: number | null
  rate_limit_rpm: number | null
  rate_limit_tpm: number | null
  cooldown_on_429_s: number
  supported_models: string | null
  health_check_url: string | null
  health_check_interval_s: number
  status: ProviderStatus
  created_at: number
  updated_at: number
}

export type NewProviderCredentialsInput = {
  id: string
  name: string
  provider_type: ProviderType
  base_url: string
  auth_type: ProviderAuthType
  auth_config: Record<string, string>
  default_headers?: Record<string, string> | null
  rate_limit_rps?: number | null
  rate_limit_rpm?: number | null
  rate_limit_tpm?: number | null
  cooldown_on_429_s?: number
  supported_models?: ReadonlyArray<string> | null
  health_check_url?: string | null
  health_check_interval_s?: number
}

export type RateLimitType = "soft_429" | "hard_429" | "throttled_200" | "blocked_403" | "captcha"

export type RateLimitObservation = {
  id: number
  identity_id: string | null
  provider_id: string | null
  exchange_id: number | null
  type: RateLimitType
  http_status: number | null
  retry_after_s: number | null
  response_body_preview: string | null
  timestamp: number
}

export type NewRateLimitInput = {
  identity_id?: string | null
  provider_id?: string | null
  exchange_id?: number | null
  type: RateLimitType
  http_status?: number | null
  retry_after_s?: number | null
  response_body_preview?: string | null
}
