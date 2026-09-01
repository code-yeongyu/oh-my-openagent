import type { MessageRenderer } from "@code-yeongyu/senpi"
import {
  formatTargetWithModel,
  linesComponent,
  normalizeRendererText,
  type CompletionDetails,
} from "@oh-my-opencode/senpi-task"
import { buildNoticeBox, type NoticeSpec, type NoticeTone } from "@oh-my-opencode/senpi-task/notice-box"

import type { TeamMemberLivenessDetails } from "./member-liveness"

// Compact renderer for the dead-chain warning: one line, the same text the notify carried.
export const renderCategoryUnavailable: MessageRenderer<Readonly<Record<string, unknown>>> = (message) => {
  const content = (message as { readonly content?: unknown }).content
  const text = typeof content === "string" && content.length > 0 ? content : "(category unavailable)"
  return linesComponent([normalizeRendererText(text)])
}

// Render completion details as user-facing notice boxes without exposing the LLM-facing envelope.
export const renderTaskCompletion: MessageRenderer<readonly CompletionDetails[]> = (message, options, theme) => {
  const details = message.details ?? []
  if (details.length === 0) {
    return buildNoticeBox({ title: "· Task completion", tone: "dim", why: "Task completion details are unavailable." }, options, theme)
  }
  const components = details.map((detail) => buildNoticeBox(completionNotice(detail), options, theme))
  return {
    render: (width) => components.flatMap((component) => component.render(width)),
    invalidate: () => components.forEach((component) => component.invalidate?.()),
  }
}

export const renderTeamMemberLiveness: MessageRenderer<TeamMemberLivenessDetails> = (message, options, theme) => {
  const details = message.details
  if (details === undefined) {
    return buildNoticeBox({ title: "⚠ Team member unavailable", tone: "warning", why: "Team member liveness details are unavailable." }, options, theme)
  }
  const state = normalizeRendererText(details.lastKnownState)
  const deliveryKey = "deliveryKey" in details && typeof details.deliveryKey === "string" ? details.deliveryKey : undefined
  return buildNoticeBox(
    {
      title: `⚠ Team member unavailable · ${normalizeRendererText(details.memberName)}`,
      tone: details.lastKnownState === "error" || details.lastKnownState === "lost" ? "error" : "warning",
      why: `The team member is no longer making progress; its last known state was ${state}.`,
      extra: details.reason === undefined ? [] : [{ text: normalizeRendererText(details.reason), tone: "warning" }],
      ...noticeExpandedLine(joinNoticeFields([
        deliveryKey === undefined ? undefined : `delivery ${normalizeRendererText(deliveryKey)}`,
      ])),
    },
    options,
    theme,
  )
}

function completionNotice(detail: CompletionDetails): NoticeSpec {
  const status = normalizeRendererText(detail.status)
  const response = normalizeRendererText(detail.final_response).trim()
  const continuation = normalizeRendererText(detail.continuation_hint).trim()
  const resultFile = detail.final_response_file === undefined ? undefined : normalizeRendererText(detail.final_response_file)
  return {
    title: `${statusGlyph(detail.status)} Task complete · ${normalizeRendererText(detail.name)}`,
    tone: statusTone(detail.status),
    why: response.length === 0 ? `Task ${status}.` : response,
    extra: [{
      text: joinNoticeFields([
        `id ${normalizeRendererText(detail.task_id)}`,
        formatTargetWithModel({
          category: detail.category,
          agentType: detail.agent_type,
          resolvedModel: detail.resolved_model,
          model: detail.model,
        }),
        `duration ${formatDuration(detail.duration_ms)}`,
        detail.tokens === undefined ? undefined : `tokens ${detail.tokens}`,
        detail.run_stats?.tool_calls === undefined ? undefined : `tools ${detail.run_stats.tool_calls}`,
        detail.run_stats?.tokens_per_second === undefined ? undefined : `tps ${detail.run_stats.tokens_per_second}`,
      ]),
    }],
    ...noticeExpandedLine(joinNoticeFields([
      continuation.length === 0 ? undefined : continuation,
      resultFile === undefined ? undefined : `result file ${resultFile}`,
    ])),
  }
}

function statusTone(status: string): NoticeTone {
  if (status === "completed") return "success"
  if (status === "error" || status === "lost") return "error"
  if (status === "cancelled" || status === "interrupted") return "warning"
  if (status === "running") return "accent"
  return "dim"
}

function statusGlyph(status: string): string {
  const tone = statusTone(status)
  if (tone === "success") return "●"
  if (tone === "error") return "✗"
  if (tone === "warning") return "⚠"
  if (tone === "accent") return "◐"
  return "·"
}

function joinNoticeFields(fields: readonly (string | undefined)[]): string {
  return fields.filter((field): field is string => field !== undefined && field.length > 0).join(" · ")
}

function noticeExpandedLine(text: string): { readonly expandedLine?: string } {
  return text.length === 0 ? {} : { expandedLine: text }
}

function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "unknown"
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`
  const seconds = durationMs / 1000
  if (seconds < 60) return `${seconds.toFixed(2).replace(/0+$/u, "").replace(/\.$/u, "")}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${Math.round(seconds - minutes * 60)}s`
}
