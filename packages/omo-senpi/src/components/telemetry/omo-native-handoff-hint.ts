import type { EventTelemetryProperties } from "@oh-my-opencode/telemetry-core"

import type { SenpiExtensionAPI } from "../../extension/types"
import { HANDOFF_HINT_ACTIONS, type OmoNativeEventName } from "./event-schemas"
import { hashSessionId, maskProviderAndModel } from "./product-identity"

// Senpi's handoff-hint builtin publishes this on the extension event bus (senpi#3230).
export const SENPI_HANDOFF_HINT_EVENT = "handoff_hint"

type HandoffHintAction = (typeof HANDOFF_HINT_ACTIONS)[number]

type HandoffHintPayload = {
  readonly action: HandoffHintAction
  readonly sessionId: string
  readonly provider: string
  readonly model: string
  readonly contextTokens: number
  readonly nextReplyUsd: number
  readonly freshUsd: number
  readonly savingUsd: number
  readonly subscription: boolean
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function parsePayload(value: unknown): HandoffHintPayload | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const record = value as Record<string, unknown>
  const action = HANDOFF_HINT_ACTIONS.find((candidate) => candidate === record.action)
  if (action === undefined) return undefined
  if (typeof record.sessionId !== "string" || typeof record.provider !== "string" || typeof record.model !== "string") return undefined
  if (![record.contextTokens, record.nextReplyUsd, record.freshUsd, record.savingUsd].every(isFiniteNumber)) return undefined
  if (typeof record.subscription !== "boolean") return undefined
  return record as unknown as HandoffHintPayload
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

export function registerOmoNativeHandoffHintTelemetry(
  pi: SenpiExtensionAPI,
  options: {
    readonly captureEvent: (name: OmoNativeEventName, properties: EventTelemetryProperties) => void
    readonly hashSessionId?: (sessionId: string) => string
  },
): void {
  const detach = pi.events?.on(SENPI_HANDOFF_HINT_EVENT, (payload) => {
    const event = parsePayload(payload)
    if (event === undefined) return
    const masked = maskProviderAndModel(event.provider, event.model)
    options.captureEvent("handoff_hint", {
      $session_id: (options.hashSessionId ?? hashSessionId)(event.sessionId),
      action: event.action,
      context_tokens: Math.round(event.contextTokens),
      fresh_usd: round(event.freshUsd),
      model_id: masked.model_id,
      next_reply_usd: round(event.nextReplyUsd),
      provider: masked.provider,
      saving_usd: round(event.savingUsd),
      subscription: event.subscription,
    })
  })
  if (detach !== undefined) pi.on("session_shutdown", detach)
}
