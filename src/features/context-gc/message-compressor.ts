import type { ContextGcConfig, MessageWithParts } from "./types"
import type { TierClassification } from "./tier-classifier"
import { buildToolCallMap } from "./pair-validator"
import { applyMessageCompression } from "./compressors/per-message"

export type CompressStats = {
  toolOutputsCompressed: number
  thinkingBlocksRemoved: number
  textPartsCompressed: number
  systemPartsRemoved: number
  messagesRemoved: number
}

export const DEFAULT_MAX_GONE_PER_CYCLE = 5

export function compressMessages(
  messages: MessageWithParts[],
  classifications: TierClassification[],
  config: ContextGcConfig | undefined,
  tokensToFree: number,
): CompressStats {
  const maxGone = config?.max_gone_per_cycle ?? DEFAULT_MAX_GONE_PER_CYCLE
  const stats: CompressStats = {
    toolOutputsCompressed: 0,
    thinkingBlocksRemoved: 0,
    textPartsCompressed: 0,
    systemPartsRemoved: 0,
    messagesRemoved: 0,
  }

  const removeIndices: number[] = []
  for (const classification of classifications) {
    if (classification.tier === "gone") {
      removeIndices.push(classification.messageIndex)
    }
  }

  applyMessageCompression(messages, classifications, tokensToFree, stats)

  if (removeIndices.length > 0) {
    const safeIndices = filterSafeRemovals(messages, removeIndices, maxGone)
    safeIndices.sort((a, b) => b - a)
    for (const idx of safeIndices) {
      messages.splice(idx, 1)
      stats.messagesRemoved++
    }
  }

  return stats
}

function filterSafeRemovals(
  messages: MessageWithParts[],
  removeIndices: number[],
  maxGone: number,
): number[] {
  const removeSet = new Set(removeIndices)

  const toolCallMap = buildToolCallMap(messages)
  for (const [, locations] of toolCallMap) {
    if (locations.length < 2) continue
    const anyRemoved = locations.some((loc) => removeSet.has(loc.messageIndex))
    if (anyRemoved) {
      for (const loc of locations) {
        removeSet.add(loc.messageIndex)
      }
    }
  }

  const sorted = [...removeSet].sort((a, b) => a - b).slice(0, maxGone)

  const originalLastRole = messages.length > 0
    ? (messages[messages.length - 1].info.role ?? "unknown")
    : "unknown"

  if (originalLastRole === "assistant") {
    return sorted
  }

  const candidates = [...sorted]
  while (candidates.length > 0) {
    const removeFinal = new Set(candidates)
    let lastSurvivingRole = "unknown"
    for (let i = messages.length - 1; i >= 0; i--) {
      if (removeFinal.has(i)) continue
      lastSurvivingRole = messages[i].info.role ?? "unknown"
      break
    }

    if (lastSurvivingRole !== "assistant") {
      return candidates
    }

    candidates.pop()
  }

  return candidates
}
