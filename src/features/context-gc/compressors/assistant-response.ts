import type { GcPart } from "../types"
import type { Tier } from "../tier-classifier"
import { estimateTokens } from "../token-budget"

const THINKING_TYPES = new Set(["thinking", "redacted_thinking", "reasoning"])

const COLD_MAX_CHARS = 200

type PartModification = {
  partIndex: number
  action: "remove" | "replace"
  newText?: string
}

function isThinkingPart(part: GcPart): boolean {
  return THINKING_TYPES.has(part.type)
}

function isTextPart(part: GcPart): boolean {
  return part.type === "text"
}

function getTextContent(part: GcPart): string {
  return part.text ?? part.thinking ?? ""
}

function truncateText(text: string, maxChars: number, brainId: number | null): string {
  if (text.length <= maxChars) {
    return text
  }

  const truncated = text.slice(0, maxChars)
  const brainRef = brainId !== null
    ? ` [brain#${brainId}: full response]`
    : ""

  return `${truncated}...${brainRef}`
}

export function computeAssistantModifications(
  parts: GcPart[],
  tier: Tier,
  brainId: number | null,
): PartModification[] {
  if (tier === "hot") {
    return []
  }

  const modifications: PartModification[] = []

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]

    if (isThinkingPart(part)) {
      modifications.push({ partIndex: i, action: "remove" })
      continue
    }

    if (!isTextPart(part)) {
      continue
    }

    const text = getTextContent(part)
    if (estimateTokens(text) < 100) {
      continue
    }

    if (tier === "cold") {
      modifications.push({
        partIndex: i,
        action: "replace",
        newText: truncateText(text, COLD_MAX_CHARS, brainId),
      })
    }
  }

  return modifications
}
