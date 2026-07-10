import type { MessageRenderer } from "@code-yeongyu/senpi"
import { linesComponent, normalizeRendererText } from "@oh-my-opencode/senpi-task"

// The details a team lead-message custom message carries; the renderer shows the sender + envelope.
export type TeamMessageDetails = { readonly from?: string; readonly messageId?: string }

// Render the senpi-task.team-message custom message as a compact card: the pre-built envelope content
// split into terminal lines. Renderer-only, so it never re-enters the LLM context beyond the message
// the engine already delivered.
export const renderTeamMessage: MessageRenderer<TeamMessageDetails> = (message) => {
  const content = typeof message.content === "string" ? message.content : ""
  return linesComponent(content.length > 0 ? content.split("\n").map(normalizeRendererText) : ["(team message)"])
}
