import type { OhMyOpenCodeConfig } from "../config"
import { applyAgentVariant, resolveAgentVariant, resolveVariantForModel } from "./agent-variant"

export type FirstMessageVariantGate = {
  shouldOverride(sessionID?: string): boolean
  markApplied(sessionID?: string): void
}

export type ChatMessageInput = {
  sessionID?: string
  agent?: string
  model?: { providerID: string; modelID: string }
  variant?: string
}

export type ChatMessage = { variant?: string }

export function applyChatMessageVariant(
  config: OhMyOpenCodeConfig,
  gate: FirstMessageVariantGate,
  input: ChatMessageInput,
  message: ChatMessage
): void {
  // Respect user-selected variant (e.g. ctrl+t / variant_cycle) before any plugin defaults.
  if (input.variant !== undefined && message.variant === undefined) {
    message.variant = input.variant
  }

  // The first message in a newly created root session historically didn't pick up
  // agent/category defaults, so we apply them once. Never override an existing variant.
  if (gate.shouldOverride(input.sessionID)) {
    const resolved = input.model && input.agent
      ? resolveVariantForModel(config, input.agent, input.model)
      : resolveAgentVariant(config, input.agent)

    if (resolved !== undefined && message.variant === undefined) {
      message.variant = resolved
    }
    gate.markApplied(input.sessionID)
    return
  }

  if (input.model && input.agent && message.variant === undefined) {
    const resolved = resolveVariantForModel(config, input.agent, input.model)
    if (resolved !== undefined) {
      message.variant = resolved
    }
  } else {
    applyAgentVariant(config, input.agent, message)
  }
}
