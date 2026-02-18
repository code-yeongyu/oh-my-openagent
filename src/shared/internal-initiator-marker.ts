export const OMO_INTERNAL_INITIATOR_MARKER = "<!-- OMO_INTERNAL_INITIATOR -->"

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
