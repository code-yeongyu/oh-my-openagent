export type HandoffContext = {
  prior: string
  current: string
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

/**
 * Pure renderer of the identity-handoff marker injected when the active agent
 * changes mid-session. The marker re-anchors the LLM so it stops treating
 * prior assistant turns as its own output.
 */
export function renderHandoffMarker(ctx: HandoffContext): string {
  const prior = escapeXmlAttr(ctx.prior)
  const current = escapeXmlAttr(ctx.current)
  return [
    `<identity-handoff prior="${prior}" current="${current}">`,
    `You are now ${ctx.current}.`,
    `Prior assistant turns in this conversation were authored by ${ctx.prior}; read them as handoff context, not as your own past output.`,
    `Apply the persona, tools, and policies configured for ${ctx.current} from this turn forward.`,
    `</identity-handoff>`,
  ].join("\n")
}
