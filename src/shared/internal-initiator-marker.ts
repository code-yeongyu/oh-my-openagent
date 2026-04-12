export const OMO_INTERNAL_INITIATOR_MARKER = "[OMO_INTERNAL]"
export const OMO_INTERNAL_INITIATOR_COMMENT = "<!-- OMO_INTERNAL_INITIATOR -->"

type InternalWrapperTag = "system-reminder" | "system-directive"

function wrapInternalText(text: string, tag: InternalWrapperTag): string {
  return `<${tag}>\n${text}\n</${tag}>`
}

function createHiddenInternalTextPart(text: string, tag: InternalWrapperTag): {
  type: "text"
  text: string
  synthetic: true
} {
  return {
    type: "text",
    text: `${wrapInternalText(text, tag)}\n${OMO_INTERNAL_INITIATOR_COMMENT}`,
    synthetic: true,
  }
}

export function createInternalAgentTextPart(text: string): {
  type: "text"
  text: string
  synthetic: true
} {
  return {
    type: "text",
    text: `${text}\n${OMO_INTERNAL_INITIATOR_MARKER}`,
    synthetic: true,
  }
}

export function createHiddenSystemReminderTextPart(text: string): {
  type: "text"
  text: string
  synthetic: true
} {
  return createHiddenInternalTextPart(text, "system-reminder")
}

export function createHiddenSystemDirectiveTextPart(text: string): {
  type: "text"
  text: string
  synthetic: true
} {
  return createHiddenInternalTextPart(text, "system-directive")
}

export function hasInternalInitiatorMarker(text: string): boolean {
  return text.includes(OMO_INTERNAL_INITIATOR_MARKER) || text.includes(OMO_INTERNAL_INITIATOR_COMMENT)
}
