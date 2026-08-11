import {
  completionMessageLines,
  linesComponent,
  normalizeRendererText,
  type CompletionDetails,
} from "@oh-my-opencode/senpi-task"

import type { TeamMemberLivenessDetails } from "../team/member-liveness"

// Structural renderer seam (senpi MessageRenderer parity). The harness registers renderers through
// `registerMessageRenderer(customType, renderer)` which is typed as unknown on the contract; this
// local type keeps the renderers themselves typed against the component-shaped return value
// (`render(width)` yields the user-facing lines) without importing a harness message-renderer type.
// The message member stays loose (index signature) so harness message envelopes (role/customType/
// timestamp/...) flow in structurally.
export type OmoMessageRenderer<TDetails = unknown> = (
  message: { readonly details?: TDetails; readonly content?: unknown } & Record<string, unknown>,
  options?: unknown,
  theme?: unknown,
) => { render(width: number): string[] }

// Compact renderer for the dead-chain warning: one line, the same text the notify carried.
export const renderCategoryUnavailable: OmoMessageRenderer<Readonly<Record<string, unknown>>> = (message) => {
  const content = (message as { readonly content?: unknown }).content
  const text = typeof content === "string" && content.length > 0 ? content : "(category unavailable)"
  return linesComponent([normalizeRendererText(text)])
}

// Render completion details as user-facing rows without exposing the LLM-facing notification envelope.
export const renderTaskCompletion: OmoMessageRenderer<readonly CompletionDetails[]> = (message) => {
  const details = message.details ?? []
  if (details.length === 0) return linesComponent(["(task completion)"])
  return linesComponent((width) => completionMessageLines(details, width))
}

export const renderTeamMemberLiveness: OmoMessageRenderer<TeamMemberLivenessDetails> = (message) => {
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
