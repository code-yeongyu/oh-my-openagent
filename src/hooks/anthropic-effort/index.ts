import { log } from "../../shared"

const OPUS_4_6_PATTERN = /claude-opus-4[-.]6/i

function normalizeModelID(modelID: string): string {
  return modelID.replace(/\.(\d+)/g, "-$1")
}

function isClaudeProvider(providerID: string, modelID: string): boolean {
  if (["anthropic", "opencode"].includes(providerID)) return true
  if (providerID === "github-copilot" && modelID.toLowerCase().includes("claude")) return true
  return false
}

function isOpus46(modelID: string): boolean {
  const normalized = normalizeModelID(modelID)
  return OPUS_4_6_PATTERN.test(normalized)
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
      if (!isOpus46(model.modelID)) return
      if (output.options.effort !== undefined) return

      output.options.effort = "max"
      log("anthropic-effort: injected effort=max", {
        sessionID: input.sessionID,
        provider: model.providerID,
        model: model.modelID,
      })
    },
  }
}
