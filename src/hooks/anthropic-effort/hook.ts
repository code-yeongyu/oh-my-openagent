import { log, normalizeModelID } from "../../shared"

const OPUS_PATTERN = /claude-.*opus/i

function isClaudeProvider(providerID: string, modelID: string): boolean {
  if (["anthropic", "google-vertex-anthropic", "opencode"].includes(providerID)) return true
  if (providerID === "github-copilot" && modelID.toLowerCase().includes("claude")) return true
  return false
}

function isOpusModel(modelID: string): boolean {
  const normalized = normalizeModelID(modelID)
  return OPUS_PATTERN.test(normalized)
}

interface ChatParamsInput {
  sessionID: string
  agent: { name?: string }
  model: { providerID: string; modelID: string }
  provider: { id: string }
  message: { variant?: string }
}

interface ChatParamsOutput {
  temperature?: number
  topP?: number
  topK?: number
  options: Record<string, unknown>
}

/**
 * Valid thinking budget levels per model tier.
 * Opus supports "max"; all other Claude models cap at "high".
 */
const MAX_VARIANT_BY_TIER: Record<string, string> = {
  opus: "max",
  default: "high",
}

function clampVariant(variant: string, isOpus: boolean): string {
  if (variant !== "max") return variant
  return isOpus ? MAX_VARIANT_BY_TIER.opus : MAX_VARIANT_BY_TIER.default
}

export function createAnthropicEffortHook() {
  return {
    "chat.params": async (
      input: ChatParamsInput,
      output: ChatParamsOutput
    ): Promise<void> => {
      const { model, message } = input
      if (!model?.modelID || !model?.providerID) return
      if (message.variant !== "max") return
      if (!isClaudeProvider(model.providerID, model.modelID)) return
      if (output.options.effort !== undefined) return

      const opus = isOpusModel(model.modelID)
      const clamped = clampVariant(message.variant, opus)
      output.options.effort = clamped

      if (!opus) {
        // Override the variant so OpenCode doesn't pass "max" to the API
        ;(message as { variant?: string }).variant = clamped
        log("anthropic-effort: clamped variant max→high for non-Opus model", {
          sessionID: input.sessionID,
          provider: model.providerID,
          model: model.modelID,
        })
      } else {
        log("anthropic-effort: injected effort=max", {
          sessionID: input.sessionID,
          provider: model.providerID,
          model: model.modelID,
        })
      }
    },
  }
}
