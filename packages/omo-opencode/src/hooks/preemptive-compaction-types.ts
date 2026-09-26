export interface TokenInfo {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

export interface CachedCompactionState {
  providerID: string
  modelID: string
  tokens: TokenInfo
  /** Agent that produced the cached message; used to resolve the compaction pin. */
  agent?: string
}

/**
 * One in-flight summarize per session. `attemptID` lets a superseded attempt
 * detect that it no longer owns the session's admission guard, so its late
 * cleanup cannot clear the guard of a newer attempt.
 */
export interface SummarizeAttempt {
  startedAt: number
  attemptID: number
}

export interface PreemptiveCompactionClient {
  session: {
    messages: (input: {
      path: { id: string }
      query?: { directory: string }
    }) => Promise<unknown>
    summarize: (input: {
      path: { id: string }
      body: { providerID: string; modelID: string; auto?: boolean }
      query: { directory: string }
    }) => Promise<unknown>
  }
  tui: {
    showToast: (input: {
      body: {
        title: string
        message: string
        variant: "warning"
        duration: number
      }
    }) => Promise<unknown>
  }
}

export interface PreemptiveCompactionContext {
  client: PreemptiveCompactionClient
  directory: string
}
