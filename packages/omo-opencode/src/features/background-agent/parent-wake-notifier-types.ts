import type { PromptDispatchClient, PromptMessagesQuery } from "../../shared/prompt-async-gate/types"
import type { ParentWakePromptContext } from "./parent-wake-dedupe"
import type { SessionExistenceStatus } from "./session-existence"

type ParentWakePromptBody = ParentWakePromptContext & {
  readonly noReply?: boolean
  readonly parts: { readonly type: "text"; readonly text: string }[]
}

type ParentWakePromptAsyncInput = {
  readonly path: { readonly id: string }
  readonly body: ParentWakePromptBody
  readonly query: { readonly directory: string }
}

export type ParentWakeNotifierClient = PromptDispatchClient & {
  readonly session: NonNullable<PromptDispatchClient["session"]> & {
    readonly messages: (input: {
      readonly path: { readonly id: string }
      readonly query: PromptMessagesQuery
    }) => Promise<unknown>
    readonly promptAsync: (input: ParentWakePromptAsyncInput) => Promise<unknown>
  }
}

export type ParentWakeNotifierDeps = {
  readonly client: ParentWakeNotifierClient
  readonly directory: string
  readonly enqueueNotificationForParent: (
    parentSessionID: string | undefined,
    operation: () => Promise<void>,
  ) => Promise<void>
  readonly checkParentSessionExistence?: (sessionID: string) => Promise<SessionExistenceStatus>
}

export type ParentWakeNotifierOptions = {
  readonly pendingRetryMs: number
  readonly acceptedMessageSkewMs: number
  readonly toolCallDeferMaxMs: number
  readonly failureRequeueWindowMs: number
  /**
   * If the latest message in the parent session is a `user` message added
   * within this window, the parent-wake injection is deferred. Prevents the
   * race where a parent-wake `dispatchInternalPrompt` collides with a fresh
   * user prompt, which on macOS/Electron has triggered native SIGABRT crashes
   * inside OpenCode's `@parcel/watcher` TSFN callback path. See issue #4120.
   */
  readonly userMessageInProgressWindowMs: number
  readonly parentSessionActivityInProgressWindowMs?: number
  /**
   * Upper bound on cumulative deferral time for a single parent-wake before it
   * is force-dispatched as an admit-only noReply. Bounds the unbounded-deferral
   * starvation case (upstream #5089). Defaults to 120s when omitted.
   */
  readonly maxDeferMs?: number
  /**
   * Consecutive failure-requeue windows (no assistant/tool output after the
   * wake) tolerated before a silently-dropped dispatched wake is requeued into
   * the pending queue (upstream P1). Defaults to 3 when omitted.
   */
  readonly maxWindowRefreshes?: number
}
