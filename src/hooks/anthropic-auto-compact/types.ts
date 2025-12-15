export interface ParsedTokenLimitError {
  currentTokens: number
  maxTokens: number
  requestId?: string
  errorType: string
  providerID?: string
  modelID?: string
}

export interface RetryState {
  attempt: number
  lastAttemptTime: number
}

export interface FallbackState {
  revertAttempt: number
  lastRevertedMessageID?: string
}

export interface AutoCompactState {
  pendingCompact: Set<string>
  errorDataBySession: Map<string, ParsedTokenLimitError>
  retryStateBySession: Map<string, RetryState>
  fallbackStateBySession: Map<string, FallbackState>
}

export const RETRY_CONFIG = {
  maxAttempts: 2,
  initialDelayMs: 2000,
  backoffFactor: 2,
  maxDelayMs: 30000,
} as const

export const FALLBACK_CONFIG = {
  maxRevertAttempts: 3,
  minMessagesRequired: 2,
} as const
