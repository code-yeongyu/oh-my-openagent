export interface NonInteractiveEnvConfig {
  disabled?: boolean
}

export interface TUICheckResult {
  isTUI: boolean
  reason?: string
  command?: string
  matchedPattern?: string
}
