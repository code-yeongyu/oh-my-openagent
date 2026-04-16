import { isProviderUsingOAuth, log, normalizeModelID } from "../../shared"

const OPUS_PATTERN = /claude-.*opus/i
const EFFORT_UNSUPPORTED_PATTERN = /claude-.*haiku/i
const INTERNAL_SKIP_AGENTS = new Set(["title", "summary", "compaction"])

function isClaudeProvider(providerID: string, modelID: string): boolean {
  if (["anthropic", "google-vertex-anthropic", "opencode"].includes(providerID)) return true
  if (providerID === "github-copilot" && modelID.toLowerCase().includes("claude")) return true
  return false
}

function isOpusModel(modelID: string): boolean {
  const normalized = normalizeModelID(modelID)
  return OPUS_PATTERN.test(normalized)
}

function isEffortUnsupportedModel(modelID: string): boolean {
  const normalized = normalizeModelID(modelID)
  return EFFORT_UNSUPPORTED_PATTERN.test(normalized)
}

function shouldSkipForInternalAgent(agentName: string | undefined): boolean {
  if (!agentName) return false
  return INTERNAL_SKIP_AGENTS.has(agentName.trim().toLowerCase())
}

/**
 * Claude Pro/Max subscriptions expose a constrained OAuth API that rejects
 * `output_config.effort: "max"` (supported values: low | medium | high) even on
 * Opus models. Detect OAuth auth by inspecting OpenCode's auth.json.
 */
function isAnthropicOAuth(providerID: string): boolean {
  if (providerID !== "anthropic") return false
  return isProviderUsingOAuth(providerID)
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

function clampVariant(variant: string, isOpus: boolean, isOAuth: boolean): string {
  if (variant !== "max") return variant
  if (isOAuth) return MAX_VARIANT_BY_TIER.default
  return isOpus ? MAX_VARIANT_BY_TIER.opus : MAX_VARIANT_BY_TIER.default
}

export function createAnthropicEffortHook() {
  return {
    "chat.params": async (
      input: ChatParamsInput,
      output: ChatParamsOutput
    ): Promise<void> => {
      const { agent, model, message } = input
      if (!model?.modelID || !model?.providerID) return
      if (isEffortUnsupportedModel(model.modelID)) return
      if (message.variant !== "max") return
      if (!isClaudeProvider(model.providerID, model.modelID)) return
      if (model.providerID === "github-copilot") return
      if (shouldSkipForInternalAgent(agent?.name)) return
      if (output.options.effort !== undefined) return

      const opus = isOpusModel(model.modelID)
      const oauth = isAnthropicOAuth(model.providerID)
      const clamped = clampVariant(message.variant, opus, oauth)
      output.options.effort = clamped

      const shouldOverrideMessageVariant = !opus || oauth

      if (shouldOverrideMessageVariant) {
        // Override the variant so OpenCode doesn't pass "max" to the API.
        // Non-Opus models cap at high; Anthropic OAuth (Claude Pro/Max) also
        // caps at high even on Opus because the OAuth API only accepts
        // low | medium | high.
        ;(message as { variant?: string }).variant = clamped
        log("anthropic-effort: clamped variant max→high", {
          sessionID: input.sessionID,
          provider: model.providerID,
          model: model.modelID,
          reason: oauth ? "anthropic-oauth" : "non-opus",
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
