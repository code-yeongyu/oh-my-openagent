import type { MessageRenderer } from "@code-yeongyu/senpi"
import {
  excerptRendererPromptText,
  joinRendererTokens,
  linesComponent,
  normalizeRendererText,
  rendererVisibleWidth,
} from "@oh-my-opencode/senpi-task"

// The details a team lead-message custom message carries; the renderer shows sender + useful content.
export type TeamMessageDetails = {
  readonly from?: string
  readonly messageId?: string
  readonly summary?: string
  readonly body?: string
}

// Render the user-facing body from structured details. The envelope fallback supports older messages
// without ever showing the protocol tags themselves.
export const renderTeamMessage: MessageRenderer<TeamMessageDetails> = (message) => {
  const content = typeof message.content === "string" ? message.content : ""
  const details = message.details ?? {}
  const body = normalizeRendererText(details.body ?? teamEnvelopeBody(content))
  const summary = normalizeRendererText(details.summary ?? "")
  const heading = joinRendererTokens([
    "team message",
    optionalToken("from", details.from),
    optionalToken("id", details.messageId),
    summary.length === 0 ? undefined : `summary:${summary}`,
  ])
  return linesComponent((width) => {
    const prefix = 'message:"'
    const excerptWidth = Math.max(0, width - rendererVisibleWidth(prefix) - rendererVisibleWidth('"'))
    return [
      heading,
      ...(body.length === 0 ? [] : [`${prefix}${excerptRendererPromptText(body, excerptWidth)}"`]),
    ]
  })
}

function optionalToken(label: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const normalized = normalizeRendererText(value)
  return normalized.length === 0 ? undefined : `${label}:${normalized}`
}

function teamEnvelopeBody(content: string): string {
  const lines = content.split("\n")
  if (lines[0]?.trimStart().startsWith("<peer_message ") !== true) return content
  const last = lines.at(-1)?.trim()
  return (last === "</peer_message>" ? lines.slice(1, -1) : lines.slice(1)).join("\n")
}
