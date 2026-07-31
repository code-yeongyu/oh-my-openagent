import type { MessageRenderer } from "@code-yeongyu/senpi"
import {
  completionMessageLines,
  linesComponent,
  normalizeRendererText,
  type CompletionDetails,
} from "@oh-my-opencode/senpi-task"

import type { TeamMemberLivenessDetails } from "./member-liveness"

// Compact renderer for the dead-chain warning: one line, the same text the notify carried.
export const renderCategoryUnavailable: MessageRenderer<Readonly<Record<string, unknown>>> = (message) => {
  const content = (message as { readonly content?: unknown }).content
  const text = typeof content === "string" && content.length > 0 ? content : "(category unavailable)"
  return linesComponent([normalizeRendererText(text)])
}

// Render completion details as user-facing rows without exposing the LLM-facing notification envelope.
export const renderTaskCompletion: MessageRenderer<readonly CompletionDetails[]> = (message) => {
  const details = message.details ?? []
  if (details.length === 0) return linesComponent(["(task completion)"])
  return linesComponent((width) => completionMessageLines(details, width))
}

export const renderTeamMemberLiveness: MessageRenderer<TeamMemberLivenessDetails> = (message) => {
  const details = message.details
  if (details === undefined) return linesComponent(["(team member liveness)"])
  const reason = details.reason === undefined ? [] : [`reason:${normalizeRendererText(details.reason)}`]
  return linesComponent([
    "team member liveness",
    `member:${normalizeRendererText(details.memberName)}`,
    `last state:${normalizeRendererText(details.lastKnownState)}`,
    ...reason,
  ])
}
