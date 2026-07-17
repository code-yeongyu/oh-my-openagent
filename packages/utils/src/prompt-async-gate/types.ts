export type PromptSessionPath = { readonly id?: string } | string

export type PromptAsyncInput = {
  readonly path?: PromptSessionPath
  readonly body?: unknown
  readonly query?: unknown
  readonly signal?: unknown
  readonly [key: string]: unknown
}

export type PromptMessagesQuery = {
  readonly directory: string
  readonly limit?: number
}

export type PromptAsyncClient<TInput> = {
  readonly session?: {
    readonly status?: () => Promise<unknown>
    readonly messages?: (input: { readonly path: { readonly id: string }; readonly query: PromptMessagesQuery }) => Promise<unknown>
    readonly promptAsync?: (input: TInput) => Promise<unknown>
  }
}

export type PromptClient<TInput> = {
  readonly session?: {
    readonly status?: () => Promise<unknown>
    readonly messages?: (input: { readonly path: { readonly id: string }; readonly query: PromptMessagesQuery }) => Promise<unknown>
    readonly prompt?: (input: TInput) => Promise<unknown>
  }
}

export type InternalPromptDispatchMode = "async" | "sync"
export type InternalPromptQueueBehavior = "enqueue" | "defer"
export type PromptSessionName = "promptAsync" | "prompt"

type InternalPromptDispatchCommonArgs<TInput> = {
  readonly sessionID: string
  readonly input: TInput
  readonly source: string
  readonly dedupeKey?: string
  readonly queueBehavior?: InternalPromptQueueBehavior
  readonly queue?: boolean
  readonly queueRetryMs?: number
  readonly settleMs?: number
  readonly postDispatchHoldMs?: number
  readonly semanticDedupeHoldMs?: number
  readonly dispatchTimeoutMs?: number
  readonly checkStatus?: boolean
  readonly checkToolState?: boolean
  readonly shouldDispatch?: () => boolean
}

export type InternalPromptDispatchArgs<TInput = PromptAsyncInput> = InternalPromptDispatchCommonArgs<TInput> & (
  | { readonly mode: "async"; readonly client: PromptAsyncClient<TInput> }
  | { readonly mode: "sync"; readonly client: PromptClient<TInput> }
)

export type PromptAsyncReservation = {
  readonly source: string
  readonly dedupeKey: string
  readonly reservedAt: number
  readonly token: symbol
  readonly expiresAt?: number
}

export type InternalPromptDispatchResult =
  | { readonly status: "dispatched"; readonly response: unknown }
  | { readonly status: "queued"; readonly queuedBy: string; readonly position: number }
  | { readonly status: "active" }
  | { readonly status: "reserved"; readonly reservedBy: string }
  | { readonly status: "unavailable" }
  | { readonly status: "failed"; readonly error: unknown; readonly dispatchAttempted: boolean }

export type PromptAsyncGateResult = InternalPromptDispatchResult

export type PromptAsyncReservationReleaseOptions = {
  readonly reservedBy?: string | readonly string[]
  readonly reservedByPrefix?: string | readonly string[]
  // Lets an intentional recovery release clear a stale `model-suggestion-retry`
  // reservation that outlived its aborted dispatch. Never matches `user-prompt`.
  readonly supersedeTransientRetryOwners?: boolean
}

export type PromptDispatchClient = {
  readonly session?: {
    readonly status?: () => Promise<unknown>
    readonly messages?: (input: { readonly path: { readonly id: string }; readonly query: PromptMessagesQuery }) => Promise<unknown>
  }
}

export type QueuedInternalPrompt = {
  readonly id: number
  readonly sessionID: string
  readonly sessionName: PromptSessionName
  readonly client: PromptDispatchClient
  readonly input: unknown
  readonly source: string
  readonly dedupeKey: string
  readonly settleMs: number
  readonly postDispatchHoldMs: number
  readonly semanticDedupeHoldMs: number
  readonly dispatchTimeoutMs: number
  readonly queueRetryMs: number
  readonly checkStatus: boolean
  readonly checkToolState: boolean
  readonly shouldDispatch?: () => boolean
  readonly dispatch: (input: unknown) => Promise<unknown>
}
