import type { ContextGcConfig, GcPart, MessageWithParts } from "./types"
import { estimateTokens } from "./token-budget"
import { applyRelevancePromotions } from "./relevance-scorer"

export type Tier = "hot" | "warm" | "cold" | "gone"

const DEFAULT_HOT_TURNS = 3
const DEFAULT_WARM_TURNS = 10
const DEFAULT_COLD_TURNS = 25
const DEFAULT_GONE_TURNS = 40
const DEFAULT_MIN_HOT_TURNS = 3

export type TierClassification = {
  tier: Tier
  messageIndex: number
  turnAge: number
  estimatedTokens: number
}

export function estimatePartsTokens(parts: GcPart[]): number {
  let total = 0
  for (const part of parts) {
    if (typeof part.text === "string") {
      total += estimateTokens(part.text)
    } else if (part.state && typeof part.state.output === "string") {
      total += estimateTokens(part.state.output)
    } else if (typeof part.thinking === "string") {
      total += estimateTokens(part.thinking)
    }
  }
  return total
}

function countAssistantTurns(messages: MessageWithParts[]): number {
  let count = 0
  for (const msg of messages) {
    if (msg.info.role === "assistant") {
      count++
    }
  }
  return count
}

export function classifyMessages(
  messages: MessageWithParts[],
  config: ContextGcConfig | undefined,
): TierClassification[] {
  const hotTurns = Math.max(config?.min_hot_turns ?? DEFAULT_MIN_HOT_TURNS, config?.hot_turns ?? DEFAULT_HOT_TURNS)
  const warmTurns = config?.warm_turns ?? DEFAULT_WARM_TURNS
  const coldTurns = config?.cold_turns ?? DEFAULT_COLD_TURNS
  const goneTurns = config?.gone_turns ?? DEFAULT_GONE_TURNS

  const totalAssistantTurns = countAssistantTurns(messages)

  const results: TierClassification[] = []
  let assistantTurnsSeen = 0

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    const isAssistant = msg.info.role === "assistant"

    if (isAssistant) {
      assistantTurnsSeen++
    }

    const turnAge = isAssistant
      ? totalAssistantTurns - assistantTurnsSeen
      : assistantTurnsSeen > 0
        ? totalAssistantTurns - assistantTurnsSeen
        : totalAssistantTurns

    const estimatedTokens = estimatePartsTokens(msg.parts)

    let tier: Tier
    if (turnAge < hotTurns) {
      tier = "hot"
    } else if (turnAge < warmTurns) {
      tier = "warm"
    } else if (turnAge < coldTurns) {
      tier = "cold"
    } else if (turnAge < goneTurns) {
      tier = "cold"
    } else {
      tier = "gone"
    }

    results.push({ tier, messageIndex: i, turnAge, estimatedTokens })
  }

  results.reverse()
  applyRelevancePromotions(messages, results)
  return results
}
