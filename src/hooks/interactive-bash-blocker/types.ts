export interface InteractiveBashBlockerConfig {
  additionalPatterns?: string[]
  allowPatterns?: string[]
  disabled?: boolean
}

export interface BlockResult {
  blocked: boolean
  reason?: string
  command?: string
  matchedPattern?: string
}
