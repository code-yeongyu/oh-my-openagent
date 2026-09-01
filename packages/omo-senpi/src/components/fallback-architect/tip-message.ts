/**
 * User-facing tip shown when the fallback-architect nudge activates.
 *
 * Unlike the hidden directive and reminder, this message rides in with `display: true`, so the
 * user sees why the session suddenly answers from a weaker model. The registered renderer draws
 * it as a dim `Tip:`-styled block so it reads as product chrome instead of conversation.
 */

import type { MessageRenderer } from "@code-yeongyu/senpi"
import { buildNoticeBox } from "@oh-my-opencode/senpi-task/notice-box"
import { normalizeRendererText } from "@oh-my-opencode/senpi-task/renderer-text"

export const FALLBACK_ARCHITECT_TIP_TYPE = "omo-fallback-architect:tip"

export function buildFallbackTipText(input: { from: string; to: string }): string {
  return [
    `Fable 5 refused, but its refusals should not wear you down: ${input.to} picks up the refused question and reasons through its essence anyway.`,
    `Fable-5-grade depth stays reachable through the architect task category, which routes the hard parts back to ${input.from}.`,
    "Curious how this works? Ask about it with the give-me-tips skill.",
  ].join("\n")
}

export const renderFallbackTip: MessageRenderer = (message, options, theme) => {
  const lines = (typeof message.content === "string" ? message.content : "").split("\n").map(normalizeRendererText)
  const why = lines[0] ?? "Fallback architect keeps the refused question moving."
  const extra = lines.slice(1, -1).filter((line) => line.length > 0).map((text) => ({ text }))
  const expandedLine = lines.at(-1)
  return buildNoticeBox(
    {
      title: "◆ Fallback architect tip",
      tone: "accent",
      why,
      extra,
      ...(expandedLine === undefined || expandedLine.length === 0 ? {} : { expandedLine }),
    },
    options,
    theme,
  )
}
