import { createInternalAgentContinuationTextPart } from "./internal-initiator-marker"

export const OMO_RUNTIME_FALLBACK_RETRY_MARKER = "<!-- OMO_RUNTIME_FALLBACK_RETRY -->"

const RUNTIME_FALLBACK_RETRY_MARKER_PATTERN = /<!--\s*OMO_RUNTIME_FALLBACK_RETRY\s*-->/

type RuntimeFallbackRetryTextPartLike = {
  type?: string
  text?: string
}

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
