import type { GcPart } from "./types"

const CHARS_PER_TOKEN_ESTIMATE = 4

function getPartText(part: GcPart): string {
  if (typeof part.text === "string") {
    return part.text
  }

  if (typeof part.thinking === "string") {
    return part.thinking
  }

  if (part.state && typeof part.state.output === "string") {
    return part.state.output
  }

  if (part.state && typeof part.state.input === "string") {
    return part.state.input
  }

  if (typeof part.tool === "string") {
    return part.tool
  }

  return ""
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE)
}

export function estimateMessageTokens(parts: GcPart[]): number {
  let total = 0
  for (const part of parts) {
    total += estimateTokens(getPartText(part))
  }
  return total
}
