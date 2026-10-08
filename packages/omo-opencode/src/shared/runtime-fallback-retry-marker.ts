import { createInternalAgentContinuationTextPart } from "./internal-initiator-marker"

export const OMO_RUNTIME_FALLBACK_RETRY_MARKER = "<!-- OMO_RUNTIME_FALLBACK_RETRY -->"

// Text of the synthetic continuation the dispatcher sends when it finds no user prompt to retry.
export const RUNTIME_FALLBACK_RETRY_CONTINUATION_TEXT = "continue"

const RUNTIME_FALLBACK_RETRY_MARKER_PATTERN = /<!--\s*OMO_RUNTIME_FALLBACK_RETRY\s*-->/

type RuntimeFallbackRetryTextPartLike = {
  type?: string
  text?: string
}

const MARKER_ONLY_LINE_PATTERN = /^\s*(?:<!--\s*OMO_RUNTIME_FALLBACK_RETRY\s*-->|<!--\s*OMO_INTERNAL_INITIATOR\s*-->|<!--|-->)\s*$/
const INTERNAL_MARKERS_PATTERN = /<!--\s*(?:OMO_RUNTIME_FALLBACK_RETRY|OMO_INTERNAL_INITIATOR)\s*-->/g

export function hasRuntimeFallbackRetryMarker(text: string): boolean {
  return RUNTIME_FALLBACK_RETRY_MARKER_PATTERN.test(text)
}

export function createRuntimeFallbackRetryTextPart(text: string) {
  const part = createInternalAgentContinuationTextPart(text)
  return {
    ...part,
    text: `${part.text}\n${OMO_RUNTIME_FALLBACK_RETRY_MARKER}`,
  }
}

export function isRuntimeFallbackRetryTextParts(
  parts: readonly RuntimeFallbackRetryTextPartLike[] | undefined,
): boolean {
  return (parts ?? []).some((part) => (
    part.type === "text"
    && typeof part.text === "string"
    && hasRuntimeFallbackRetryMarker(part.text)
  ))
}

function isRuntimeFallbackContinuationText(text: string): boolean {
  return hasRuntimeFallbackRetryMarker(text)
    && text.replace(INTERNAL_MARKERS_PATTERN, "").trim() === RUNTIME_FALLBACK_RETRY_CONTINUATION_TEXT
}

export function hasSubstantivePromptText(parts: unknown): boolean {
  if (!Array.isArray(parts)) return false

  return parts.some((part) => {
    if (typeof part !== "object" || part === null || (part as RuntimeFallbackRetryTextPartLike).type !== "text") {
      return false
    }
    const text = (part as RuntimeFallbackRetryTextPartLike).text
    if (typeof text !== "string") return false
    // The fallback's own synthetic continuation is never the prompt to retry.
    if (isRuntimeFallbackContinuationText(text)) return false
    return text.split(/\r?\n/).some((line) => {
      const trimmed = line.trim()
      return trimmed.length > 0 && !MARKER_ONLY_LINE_PATTERN.test(trimmed)
    })
  })
}
