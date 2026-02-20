import type { AgentConfig } from "@opencode-ai/sdk"
import { isGptModel } from "../types"

export function applyModelThinkingConfig(base: AgentConfig, model: string): AgentConfig {
  if (isGptModel(model)) {
    return { ...base, reasoningEffort: "medium" }
  }

  const slashIndex = model.indexOf("/")
  const provider = slashIndex > 0 ? model.substring(0, slashIndex).toLowerCase() : ""

  if (provider === "anthropic") {
    return { ...base, thinking: { type: "enabled", budgetTokens: 32000 } }
  }

  return base
}
