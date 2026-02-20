import type { AgentConfig } from "@opencode-ai/sdk"
import { parseModelString } from "../../tools/delegate-task/model-string-parser"
import { isGptModel } from "../types"

export function applyModelThinkingConfig(base: AgentConfig, model: string): AgentConfig {
  if (isGptModel(model)) {
    return { ...base, reasoningEffort: "medium" }
  }

  const parsed = parseModelString(model)
  if (!parsed) {
    return base
  }

  if (parsed.providerID.toLowerCase() === "anthropic" || parsed.modelID.startsWith("claude")) {
    return { ...base, thinking: { type: "enabled", budgetTokens: 32000 } }
  }

  return base
}
