import type { OhMyOpenCodeConfig, RuntimeFallbackConfig } from "../../config"

export interface RuntimeFallbackInterval {
  unref: () => void
}

export type RuntimeFallbackTimeout = object | number

export interface RuntimeFallbackPluginInput {
  client: {
    session: {
      abort: (input: { path: { id: string }; throwOnError?: boolean }) => Promise<unknown>
      messages: (input: { path: { id: string }; query: { directory: string } }) => Promise<unknown>
      status?: (input?: { query: { directory: string } }) => Promise<unknown>
      promptAsync: (input: {
        path: { id: string }
        body: {
          agent?: string
          model: { providerID: string; modelID: string }
          system?: string
          tools?: Record<string, boolean>
          parts: Array<{ type: "text"; text: string }>
        }
        query: { directory: string }
      }) => Promise<unknown>
    }
    tui: {
      showToast: (input: {
        body: {
          title: string
          message: string
          variant: "success" | "error" | "info" | "warning"
          duration: number
        }
      }) => Promise<unknown>
    }
  }
  directory: string
}

export interface FallbackState {
  originalModel: string
  currentModel: string
  fallbackIndex: number
  failedModels: Map<string, number>
  attemptCount: number
  pendingFallbackModel?: string
  pendingFallbackPromptMayHaveBeenAccepted?: boolean
}

export interface FallbackResult {
  success: boolean
  newModel?: string
  error?: string
  maxAttemptsReached?: boolean
}

export type AutoRetryDispatchOutcome =
  | {
      readonly accepted: true
      readonly status: "dispatched" | "queued" | "possibly-accepted"
    }
  | {
      readonly accepted: false
      readonly status: "blocked" | "invalid-model" | "failed"
      readonly reason: string
    }

export interface RuntimeFallbackOptions {
  config?: RuntimeFallbackConfig
  pluginConfig?: OhMyOpenCodeConfig
  session_timeout_ms?: number
}

export interface RuntimeFallbackHook {
  event: (input: { event: { type: string; properties?: unknown } }) => Promise<void>
  "chat.message"?: (input: { sessionID: string; agent?: string; model?: { providerID: string; modelID: string } }, output: { message: { model?: { providerID: string; modelID: string } }; parts?: Array<{ type: string; text?: string }> }) => Promise<void>
  dispose?: () => void
}

export interface HookDeps {
  ctx: RuntimeFallbackPluginInput
  config: Required<RuntimeFallbackConfig>
  options: RuntimeFallbackOptions | undefined
  pluginConfig: OhMyOpenCodeConfig | undefined
  sessionStates: Map<string, FallbackState>
  sessionLastAccess: Map<string, number>
  sessionRetryInFlight: Set<string>
  sessionRetryOwners?: Map<string, symbol>
  sessionAwaitingFallbackResult: Set<string>
  sessionFallbackTimeouts: Map<string, RuntimeFallbackTimeout>
  sessionStatusRetryKeys: Map<string, string>
  /**
   * Sessions whose in-flight request was aborted by us (to swap in a fallback
   * model), as opposed to a user-initiated stop. Consumed by
   * handleSessionError so the resulting session.error{isAbort:true} does NOT
   * reset attemptCount — that reset is what was driving the infinite retry
   * loop (every cycle started over at attempt:1). See issue #4006.
   */
  internallyAbortedSessions: Set<string>
  internalAbortOwnershipCounts?: Map<string, number>
  internalAbortRequests?: Map<string, Promise<boolean>>
  onStaleSessionCleanup?: (sessionID: string) => void
  isLifecycleActive?: () => boolean
}
