export type RetentionPolicy = {
  exchanges_response_body_days: number
  audit_log_days: number
  rate_limit_observations_days: number
  captures_days: number
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  exchanges_response_body_days: 90,
  audit_log_days: 365,
  rate_limit_observations_days: 30,
  captures_days: 30,
}
