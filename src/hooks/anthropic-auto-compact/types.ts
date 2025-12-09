export interface ParsedTokenLimitError {
  currentTokens: number
  maxTokens: number
  requestId?: string
  errorType: string
  providerID?: string
  modelID?: string
}

export interface AutoCompactState {
  pendingCompact: Set<string>
  errorDataBySession: Map<string, ParsedTokenLimitError>
}
