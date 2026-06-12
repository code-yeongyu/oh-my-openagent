export const OMO_INTERNAL_INITIATOR_MARKER = "<!-- OMO_INTERNAL_INITIATOR -->"

export const OMO_INTERNAL_NOREPLY_MARKER = "<!-- OMO_INTERNAL_NOREPLY -->"

const INTERNAL_INITIATOR_MARKER_DETECT_PATTERN = /<!--\s*OMO_INTERNAL_INITIATOR\s*-->/
const INTERNAL_NOREPLY_MARKER_DETECT_PATTERN = /<!--\s*OMO_INTERNAL_NOREPLY\s*-->/
const INTERNAL_INITIATOR_MARKER_PATTERN = /\n*<!--\s*OMO_INTERNAL_INITIATOR\s*-->\s*/g
const INTERNAL_NOREPLY_MARKER_PATTERN = /\n*<!--\s*OMO_INTERNAL_NOREPLY\s*-->\s*/g

export type InternalInitiatorTextPartLike = {
  type?: string
  text?: string
  synthetic?: boolean
}

export type InternalInitiatorMessageLike = {
  role?: string
  info?: { role?: string }
  parts?: readonly InternalInitiatorTextPartLike[]
}

export function hasInternalInitiatorMarker(text: string): boolean {
  return INTERNAL_INITIATOR_MARKER_DETECT_PATTERN.test(text)
}

export function hasInternalNoReplyMarker(text: string): boolean {
  return INTERNAL_NOREPLY_MARKER_DETECT_PATTERN.test(text)
}

export function isTextPartLike(
  part: InternalInitiatorTextPartLike
): part is InternalInitiatorTextPartLike & { type: "text"; text: string } {
  return part.type === "text" && typeof part.text === "string"
}

export function isSyntheticOrInternalTextPart(
  part: InternalInitiatorTextPartLike
): boolean {
  return (
    isTextPartLike(part) &&
    (part.synthetic === true || hasInternalInitiatorMarker(part.text))
  )
}

export function isRealUserTextPart(
  part: InternalInitiatorTextPartLike
): part is InternalInitiatorTextPartLike & { type: "text"; text: string } {
  return isTextPartLike(part) && !isSyntheticOrInternalTextPart(part)
}

export function isSyntheticOrInternalOnlyTextParts(
  parts: readonly InternalInitiatorTextPartLike[] | undefined
): boolean {
  const textParts = (parts ?? []).filter(isTextPartLike)
  return textParts.length > 0 && textParts.every(isSyntheticOrInternalTextPart)
}

export function isSyntheticOrInternalUserMessage(
  message: InternalInitiatorMessageLike
): boolean {
  const role = message.info?.role ?? message.role
  return role === "user" && isSyntheticOrInternalOnlyTextParts(message.parts)
}

function isNoReplyTextPart(part: InternalInitiatorTextPartLike): boolean {
  return isTextPartLike(part) && hasInternalNoReplyMarker(part.text)
}

export function isTerminalNoReplyUserMessage(
  message: InternalInitiatorMessageLike
): boolean {
  const role = message.info?.role ?? message.role
  if (role !== "user") {
    return false
  }
  const textParts = (message.parts ?? []).filter(isTextPartLike)
  return textParts.some(isNoReplyTextPart)
}

export function isRealUserMessage(
  message: InternalInitiatorMessageLike
): boolean {
  const role = message.info?.role ?? message.role
  return role === "user" && !isSyntheticOrInternalUserMessage(message)
}

export function stripInternalInitiatorMarkers(text: string): string {
  return text
    .replace(INTERNAL_INITIATOR_MARKER_PATTERN, "")
    .replace(INTERNAL_NOREPLY_MARKER_PATTERN, "")
    .trimEnd()
}

export function createInternalAgentTextPart(text: string): {
  type: "text"
  text: string
} {
  const cleanText = stripInternalInitiatorMarkers(text)
  return {
    type: "text",
    text: `${cleanText}\n${OMO_INTERNAL_INITIATOR_MARKER}`,
  }
}

export function createInternalAgentContinuationTextPart(text: string): {
  type: "text"
  text: string
  synthetic: true
  metadata: { compaction_continue: true }
} {
  return {
    ...createInternalAgentTextPart(text),
    synthetic: true,
    metadata: { compaction_continue: true },
  }
}

export function withInternalNoReplyMarker<T extends { type: "text"; text: string }>(
  part: T
): T {
  if (hasInternalNoReplyMarker(part.text)) {
    return part
  }
  return { ...part, text: `${part.text}\n${OMO_INTERNAL_NOREPLY_MARKER}` }
}
