import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { hasActiveArchitectCategory } from "./architect-gate"
import {
  formatModelSelector,
  isFableFiveModel,
  isMessageEndEvent,
  isModelSelectEvent,
  isRefusalLikeMessage,
} from "./detection"
import {
  buildFallbackArchitectDirective,
  buildFallbackArchitectReminder,
  FALLBACK_ARCHITECT_DIRECTIVE_TYPE,
  FALLBACK_ARCHITECT_REMINDER_TYPE,
} from "./directive"

const FALLBACK_ARCHITECT_DISABLED_FLAG = "omo-senpi-fallback-architect-disabled"

type FallbackArchitectInputResult =
  | { action: "continue" }
  | { action: "transform"; text: string; images?: readonly unknown[] }

export interface FallbackArchitectComponentOptions {
  /** Injectable so tests can decide the gate without depending on the developer's own omo.json. */
  hasArchitectCategory?: (cwd: string) => boolean
}

interface FallbackArchitectState {
  /**
   * Only the assistant message immediately preceding the switch may arm the nudge: senpi decides
   * `reason: "refusal"` from that same message, so a later successful answer means the next
   * fallback was not refusal driven.
   */
  refusalPending: boolean
  active: { from: string; to: string } | undefined
}

export function createFallbackArchitectComponent(
  options: FallbackArchitectComponentOptions = {},
): OmoSenpiComponent {
  const hasArchitectCategory = options.hasArchitectCategory ?? ((cwd: string) => hasActiveArchitectCategory(cwd))

  return {
    name: "fallback-architect",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      const state: FallbackArchitectState = { refusalPending: false, active: undefined }
      const isDisabled = (): boolean => ctx.config.getFlag(FALLBACK_ARCHITECT_DISABLED_FLAG) === true

      pi.on("message_end", (payload: unknown): void => {
        if (!isMessageEndEvent(payload)) return
        if (payload.message["role"] !== "assistant") return
        state.refusalPending = isRefusalLikeMessage(payload.message)
      })

      pi.on("model_select", (payload: unknown, eventCtx: unknown): void => {
        if (isDisabled() || !isModelSelectEvent(payload)) return

        // Back on fable 5 (manual switch, session restore, or senpi reverting the fallback):
        // the weaker-model advice no longer applies.
        if (isFableFiveModel(payload.model) || payload.source === "fallback-revert") {
          state.active = undefined
          state.refusalPending = false
          return
        }

        if (payload.source !== "fallback") return
        if (!isFableFiveModel(payload.previousModel) || !state.refusalPending) return

        const cwd = extractCwd(eventCtx) ?? process.cwd()
        if (!hasArchitectCategory(cwd)) {
          ctx.logger.info("omo-senpi fallback-architect skipped", { reason: "architect-category-inactive" })
          state.refusalPending = false
          return
        }

        const from = formatModelSelector(payload.previousModel)
        const to = formatModelSelector(payload.model)
        pi.sendMessage({
          customType: FALLBACK_ARCHITECT_DIRECTIVE_TYPE,
          content: buildFallbackArchitectDirective({ from, to }),
          display: false,
        })
        state.active = { from, to }
        state.refusalPending = false
        ctx.logger.info("omo-senpi fallback-architect directive injected", { from, to })
      })

      pi.on("input", (payload: unknown): FallbackArchitectInputResult => {
        if (isDisabled() || state.active === undefined) return { action: "continue" }
        if (!isUserSourcedInput(payload)) return { action: "continue" }

        const reminder = buildFallbackArchitectReminder({ from: state.active.from })

        // A prompt queued mid-stream carries streamingBehavior. Senpi drains those queues one
        // message at a time and answers each drained message, so a separate hidden message would
        // burn its own assistant turn before the user's actual ask is handled. Carry the reminder
        // inside that one queued message instead, appending so a leading `/skill:` command still
        // expands. Same reasoning and same shape as components/ultrawork/index.ts.
        if (isQueuedDuringStreaming(payload)) {
          const images = payload["images"]
          return {
            action: "transform",
            text: `${payload["text"]}\n${reminder}`,
            ...(Array.isArray(images) ? { images } : {}),
          }
        }

        pi.sendMessage({
          customType: FALLBACK_ARCHITECT_REMINDER_TYPE,
          content: reminder,
          display: false,
        })
        return { action: "continue" }
      })
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isQueuedDuringStreaming(payload: unknown): boolean {
  return isRecord(payload) && typeof payload["streamingBehavior"] === "string"
}

function isUserSourcedInput(payload: unknown): payload is Record<string, unknown> & { text: string } {
  return (
    isRecord(payload) &&
    payload["type"] === "input" &&
    payload["source"] !== "extension" &&
    typeof payload["text"] === "string"
  )
}

function extractCwd(eventCtx: unknown): string | undefined {
  if (isRecord(eventCtx) && typeof eventCtx["cwd"] === "string") return eventCtx["cwd"]
  return undefined
}
