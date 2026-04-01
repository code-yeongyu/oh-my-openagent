export const OMO_INTERNAL_INITIATOR_MARKER = "[OMO_INTERNAL]"

export function createInternalAgentTextPart(text: string): {
  type: "text"
  text: string
} {
  return {
    type: "text",
    text: `${text}\n${OMO_INTERNAL_INITIATOR_MARKER}`,
  }
}
