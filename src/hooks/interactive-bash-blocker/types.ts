export interface InteractiveBashBlockerConfig {
  disabled?: boolean
}

export interface BlockResult {
  blocked: boolean
  reason?: string
  command?: string
  matchedPattern?: string
}
