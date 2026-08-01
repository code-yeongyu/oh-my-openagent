/**
 * User-facing tip shown when the fallback-architect nudge activates.
 *
 * Unlike the hidden directive and reminder, this message rides in with `display: true`, so the
 * user sees why the session suddenly answers from a weaker model. The registered renderer draws
 * it as a dim `Tip:`-styled block so it reads as product chrome instead of conversation.
 */

import type { MessageRenderer } from "@code-yeongyu/senpi"
import { linesComponent, normalizeRendererText } from "@oh-my-opencode/senpi-task"

export const FALLBACK_ARCHITECT_TIP_TYPE = "omo-fallback-architect:tip"

export function buildFallbackTipText(input: { from: string; to: string }): string {
  return [
    `Fable 5 refused, but its refusals should not wear you down: ${input.to} picks up the refused question and reasons through its essence anyway.`,
    `Fable-5-grade depth stays reachable through the architect task category, which routes the hard parts back to ${input.from}.`,
    "Curious how this works? Ask about it with the give-me-tips skill.",
  ].join("\n")
}

export const renderFallbackTip: MessageRenderer = (message, _options, theme) => {
  const text = typeof message.content === "string" ? message.content : ""
  const lines = text
    .split("\n")
    .map((line, index) => theme.fg("dim", index === 0 ? `Tip: ${normalizeRendererText(line)}` : normalizeRendererText(line)))
  return linesComponent(lines)
}
