import { AsyncLocalStorage } from "node:async_hooks"

import type { SenpiExtensionAPI } from "./types"

export interface ExternalUserInputRequest {
  readonly sessionId: string
  readonly send: () => void
  // A matching adapter claims the send synchronously; the producer falls back when none does.
  handled?: boolean
}

interface ExternalSubmission {
  readonly sessionId: string
  readonly generation: number
  inputId?: string
}

/**
 * Attribute an explicit external send inside OMO, without changing host provenance
 * or replaying input hooks. The host still awaits transforms and emits dispositions.
 */
export function installExternalUserInputApi(pi: SenpiExtensionAPI): void {
  if (pi.events === undefined) return

  const submissions = new AsyncLocalStorage<ExternalSubmission>()
  const on = pi.on.bind(pi)
  let liveContext: unknown
  let generation = 0

  on("session_start", (_payload, ctx) => {
    liveContext = ctx
    generation += 1
  })
  on("input", (_payload, ctx) => {
    liveContext = ctx
  })

  const unsubscribe = pi.events.on("omo:send-user-input", (request) => {
    if (!isExternalUserInputRequest(request) || request.handled === true) return
    if (request.sessionId !== sessionIdFromContext(liveContext)) return

    request.handled = true
    submissions.run({ sessionId: request.sessionId, generation }, request.send)
  })

  pi.on = (event, handler, options) => {
    if (event !== "input") {
      on(event, handler, options)
      return
    }
    on(event, (payload, ctx) => {
      const submission = submissions.getStore()
      if (submission === undefined || submission.generation !== generation
        || submission.sessionId !== sessionIdFromContext(ctx)
        || !isExtensionInput(payload)) return handler(payload, ctx)

      // Async work spawned by this turn can inherit the context. Only the input
      // that initiated the submission, identified by the HOST's ID, is human.
      submission.inputId ??= payload.inputId
      if (submission.inputId !== payload.inputId) return handler(payload, ctx)
      return handler({ ...payload, source: "rpc" }, ctx)
    }, options)
  }

  on("session_shutdown", () => {
    generation += 1
    liveContext = undefined
    unsubscribe()
  })
}

function isExternalUserInputRequest(value: unknown): value is ExternalUserInputRequest {
  return isRecord(value)
    && typeof value.sessionId === "string" && value.sessionId.length > 0
    && typeof value.send === "function"
    && (value.handled === undefined || typeof value.handled === "boolean")
}

function isExtensionInput(value: unknown): value is Record<string, unknown> & { inputId: string } {
  return isRecord(value) && value.type === "input" && value.source === "extension"
    && typeof value.inputId === "string" && value.inputId.length > 0
}

function sessionIdFromContext(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.sessionManager)) return undefined
  const manager = value.sessionManager
  if (typeof manager.getSessionId !== "function") return undefined
  const id: unknown = manager.getSessionId()
  return typeof id === "string" ? id : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
