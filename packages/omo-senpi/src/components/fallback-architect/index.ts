import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { hasActiveArchitectCategory, type GateRegistry } from "./architect-gate"
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
import {
  buildFallbackArchitectNotice,
  FALLBACK_ARCHITECT_NOTICE_TYPE,
  renderFallbackArchitectNotice,
} from "./notice"

const FALLBACK_ARCHITECT_DISABLED_FLAG = "omo-senpi-fallback-architect-disabled"

type FallbackArchitectInputResult = { action: "continue" }

export interface FallbackArchitectComponentOptions {
  /** Injectable so tests can decide the gate without depending on the developer's own omo.json. */
  hasArchitectCategory?: (cwd: string, registry?: GateRegistry) => boolean
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
  const hasArchitectCategory =
    options.hasArchitectCategory ?? ((cwd: string, registry?: GateRegistry) => hasActiveArchitectCategory(cwd, { registry }))

  return {
    name: "fallback-architect",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      const state: FallbackArchitectState = { refusalPending: false, active: undefined }
      const isDisabled = (): boolean => ctx.config.getFlag(FALLBACK_ARCHITECT_DISABLED_FLAG) === true

      pi.registerMessageRenderer?.(FALLBACK_ARCHITECT_NOTICE_TYPE, renderFallbackArchitectNotice)

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
        if (!hasArchitectCategory(cwd, extractRegistry(eventCtx))) {
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
        // The one user-facing piece: a visible upgrade card so the fallback reads as a win, with
        // structured details for the TUI renderer and future GUI consumers.
        pi.sendMessage({
          customType: FALLBACK_ARCHITECT_NOTICE_TYPE,
          content: buildFallbackArchitectNotice({ from, to }),
          display: true,
          details: { from, to },
        })
        state.active = { from, to }
        state.refusalPending = false
        ctx.logger.info("omo-senpi fallback-architect directive injected", { from, to })
      })

      pi.on("input", (payload: unknown): FallbackArchitectInputResult => {
        if (isDisabled() || state.active === undefined) return { action: "continue" }
        if (!isUserSourcedInput(payload)) return { action: "continue" }

        // Always a hidden message, never a transform: an appended reminder renders inside the
        // user's own bubble in the TUI. On the mid-stream path senpi steers a custom message into
        // the RUNNING turn (agent-session sendCustomMessage -> agent.steer), so this costs no
        // extra assistant turn for queued prompts either, and the typed text stays byte-identical.
        pi.sendMessage({
          customType: FALLBACK_ARCHITECT_REMINDER_TYPE,
          content: buildFallbackArchitectReminder({ from: state.active.from }),
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

// Senpi's ExtensionContext.modelRegistry satisfies the port structurally; untyped contexts (tests,
// older hosts) simply yield undefined and the gate keeps its config-only behavior.
function extractRegistry(eventCtx: unknown): GateRegistry | undefined {
  if (!isRecord(eventCtx)) return undefined
  const registry = eventCtx["modelRegistry"]
  if (!isRecord(registry)) return undefined
  if (typeof registry["getAvailable"] !== "function" || typeof registry["find"] !== "function") return undefined
  return registry as unknown as GateRegistry
}
