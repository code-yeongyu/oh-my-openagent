import {
  clearTurnTraceparent,
  isTraceparent,
  publishTurnTraceparent,
  type TurnSpanAttributes,
  type TurnSpanHandle,
  type TurnTracing,
} from "@oh-my-opencode/telemetry-core"

import { pinnedModelId } from "./pinned-model-ids"
import { maskProviderAndModel } from "./product-identity"
import type { TelemetrySessionRole } from "./session-role"

/**
 * The `gen_ai.provider.name` well-known values for our provider ids (D-P VALUE table); an id with no
 * well-known value keeps our id, and `custom` stays `custom`.
 */
const GEN_AI_PROVIDER_NAMES: Readonly<Record<string, string>> = {
  anthropic: "anthropic",
  openai: "openai",
  google: "gcp.gemini",
  xai: "x_ai",
}

export type TurnModel = { readonly provider: string; readonly modelId: string }

export type OmoNativeTurnSpansOptions = {
  /** The live transport's span sink; undefined on the PostHog path, which has none. */
  readonly traces: () => TurnTracing | undefined
  readonly isConsented: () => boolean
  /** The fresh send-time consent read, taken at the moment a span would end and so be exported. */
  readonly isSendAllowed: () => boolean
  readonly sessionRole: TelemetrySessionRole
  readonly inheritedTraceparent: string | undefined
}

export type OmoNativeTurnSpans = {
  /** Opens this session's `omo.turn` span; a span still open from a turn that never ended closes as `error`. */
  readonly start: (input: {
    readonly turnIndex: number
    readonly sessionHash: string
    readonly rawSessionId: string | undefined
    readonly model: TurnModel | undefined
  }) => void
  readonly end: (input: { readonly response: TurnModel | undefined; readonly responseModelId: string | undefined; readonly failed: boolean }) => void
  /** Ends an open span that will see no `turn_end` (the run ended). */
  readonly abandon: () => void
  readonly run: <T>(fn: () => T) => T
  /**
   * Session shutdown, before the transport shuts down: a span still open is ended as `error` with
   * `omo.turn.end_reason = shutdown` while the send-time consent read holds, else dropped unended.
   */
  readonly shutdown: () => void
}

function modelAttributes(model: TurnModel): TurnSpanAttributes {
  const masked = maskProviderAndModel(model.provider, model.modelId)
  return {
    "gen_ai.provider.name": GEN_AI_PROVIDER_NAMES[masked.provider] ?? masked.provider,
    "omo.provider": masked.provider,
    "omo.model_id": pinnedModelId(masked.model_id),
  }
}

/**
 * One registration's (one session's) turn spans. State is per registration, never per component: one
 * extension instance serves every session of a shared host, and two sessions' turns may overlap.
 */
export function createOmoNativeTurnSpans(options: OmoNativeTurnSpansOptions): OmoNativeTurnSpans {
  let open: { readonly handle: TurnSpanHandle; readonly rawSessionId: string | undefined; requestModelSet: boolean } | undefined
  let lastPublished: { readonly rawSessionId: string; readonly traceparent: string } | undefined
  const parent = isTraceparent(options.inheritedTraceparent) ? options.inheritedTraceparent : undefined

  // The published traceparent lives exactly as long as its turn, so no later launch carries a stale
  // trace id: not after the turn ends, not after an opt-out stops the next one from opening.
  const unpublish = (): void => {
    if (lastPublished !== undefined) clearTurnTraceparent(lastPublished.rawSessionId, lastPublished.traceparent)
    lastPublished = undefined
  }

  // Ending a span exports it, so every ending (turn end, abandon, a replaced turn, shutdown) reads
  // consent fresh at that moment; after a withdrawal the span is dropped unended, never exported.
  const close = (status: "ok" | "error"): void => {
    if (open !== undefined && options.isSendAllowed()) open.handle.end(status)
    open = undefined
    unpublish()
  }

  return {
    start(input) {
      close("error")
      if (!options.isConsented()) return
      const handle = options.traces()?.startTurn({
        attributes: {
          "gen_ai.operation.name": "chat",
          "session.id": input.sessionHash,
          "omo.session.role": options.sessionRole,
          "omo.turn.index": input.turnIndex,
          ...(input.model === undefined ? {} : {
            ...modelAttributes(input.model),
            "gen_ai.request.model": pinnedModelId(maskProviderAndModel(input.model.provider, input.model.modelId).model_id),
          }),
        },
        ...(parent === undefined ? {} : { parentTraceparent: parent }),
      })
      if (handle === undefined) return
      open = { handle, rawSessionId: input.rawSessionId, requestModelSet: input.model !== undefined }
      // A child the task engine launches during this turn continues this trace.
      if (input.rawSessionId !== undefined) {
        publishTurnTraceparent(input.rawSessionId, handle.traceparent)
        lastPublished = { rawSessionId: input.rawSessionId, traceparent: handle.traceparent }
      }
    },
    end(input) {
      if (open === undefined) return
      if (input.response !== undefined) {
        open.handle.setAttributes({
          ...modelAttributes(input.response),
          ...(open.requestModelSet ? {} : { "gen_ai.request.model": pinnedModelId(maskProviderAndModel(input.response.provider, input.response.modelId).model_id) }),
          "gen_ai.response.model": pinnedModelId(maskProviderAndModel(input.response.provider, input.responseModelId ?? input.response.modelId).model_id),
        })
      }
      close(input.failed ? "error" : "ok")
    },
    abandon() {
      close("error")
    },
    run(fn) {
      return open === undefined ? fn() : open.handle.run(fn)
    },
    shutdown() {
      open?.handle.setAttributes({ "omo.turn.end_reason": "shutdown" })
      close("error")
    },
  }
}
