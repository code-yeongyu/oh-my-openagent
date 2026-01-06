export interface PreemptiveCompactionState {
  lastCompactionTime: Map<string, number>
  compactionInProgress: Set<string>
}

export interface TokenInfo {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

export interface ModelLimits {
  context: number
  output: number
}
