import type { AgentToolResult, Theme, ThemeColor, ToolRenderResultOptions } from "@code-yeongyu/senpi"
import { truncateToWidth } from "@earendil-works/pi-tui"

import {
  excerptRendererPromptText,
  excerptRendererText,
  joinRendererTokens,
  linesComponent,
  normalizeRendererText,
  rendererVisibleWidth,
  statusThemeColor,
} from "../task/renderers"
import type { TaskCancelInput } from "./cancel"
import type { TaskSendInput, StructuredMessageInput } from "./send-schema"
import type { CancelResultDetails, SendResultDetails } from "./types"

export type ControlRenderTheme = Pick<Theme, "fg" | "italic">

type RenderComponent = {
  render(width: number): string[]
  invalidate(): void
}

type ResultRow = {
  readonly color: ThemeColor
  readonly text: string
}

const MESSAGE_EXCERPT_MAX = 56
const REASON_EXCERPT_MAX = 40
const ELLIPSIS = "..."
const MIN_MEANINGFUL_TRUNCATED_EXCERPT_WIDTH = 8

export function renderTaskSendCall(args: TaskSendInput, theme: ControlRenderTheme): RenderComponent {
  return widthComponent((width) => theme.fg("toolTitle", taskSendCallLine(args, theme, width)))
}

export function renderTaskSendResult(
  result: AgentToolResult<SendResultDetails>,
  _options: ToolRenderResultOptions,
  theme: ControlRenderTheme,
): RenderComponent {
  const row = taskSendResultRow(result.details)
  return linesComponent([theme.fg(row.color, normalizeRendererText(row.text))])
}

export function renderTaskCancelCall(args: TaskCancelInput, theme: ControlRenderTheme): RenderComponent {
  return widthComponent((width) => theme.fg("warning", taskCancelCallLine(args, theme, width)))
}

export function renderTaskCancelResult(
  result: AgentToolResult<CancelResultDetails>,
  _options: ToolRenderResultOptions,
  theme: ControlRenderTheme,
): RenderComponent {
  const row = taskCancelResultRow(result.details)
  return linesComponent([theme.fg(row.color, normalizeRendererText(row.text))])
}

function widthComponent(renderLine: (width: number) => string): RenderComponent {
  return {
    render: (width: number): string[] => [truncateToWidth(renderLine(width), width, ELLIPSIS)],
    invalidate: (): void => {},
  }
}

function taskSendCallLine(args: TaskSendInput, theme: ControlRenderTheme, width: number): string {
  if (typeof args.message === "object" && args.message !== null) return shutdownCallLine(args, args.message, theme, width)
  const base = joinRendererTokens([
    "task_send",
    `to:${normalizeRendererText(args.to)}`,
    `deliver:${args.deliver_as ?? "followUp"}`,
  ])
  if (typeof args.message === "string") return withExcerpt(base, "message", args.message, theme, width)
  return base
}

function shutdownCallLine(
  args: TaskSendInput,
  message: StructuredMessageInput,
  theme: ControlRenderTheme,
  width: number,
): string {
  const target = `to:${normalizeRendererText(args.to)}`
  const team = optionalToken("team", args.team_run_id)
  switch (message.type) {
    case "shutdown_request": {
      const base = joinRendererTokens(["task_send shutdown:request", target, team])
      return message.reason === undefined ? base : withExcerpt(base, "reason", message.reason, theme, width)
    }
    case "shutdown_response": {
      const action = message.approve ? "approve" : "reject"
      const base = joinRendererTokens([
        `task_send shutdown:${action}`,
        target,
        team,
        optionalToken("request", message.request_id),
      ])
      return message.reason === undefined ? base : withExcerpt(base, "reason", message.reason, theme, width)
    }
    default:
      return assertNever(message)
  }
}

function taskCancelCallLine(args: TaskCancelInput, theme: ControlRenderTheme, width: number): string {
  const target = normalizeRendererText(args.task_id ?? args.name ?? "<missing>")
  const base = joinRendererTokens(["task_cancel", `target:${target}`])
  return args.reason === undefined ? base : withExcerpt(base, "reason", args.reason, theme, width)
}

function withExcerpt(
  base: string,
  label: string,
  value: string,
  theme: ControlRenderTheme,
  width: number,
): string {
  const prefix = joinRendererTokens([base, `${label}:`])
  const quoteOverhead = 2
  const maxExcerpt = label === "reason" ? REASON_EXCERPT_MAX : MESSAGE_EXCERPT_MAX
  const normalized = normalizeRendererText(value)
  if (normalized.length === 0) return base
  const available = Math.min(maxExcerpt, Math.max(0, width - rendererVisibleWidth(prefix) - quoteOverhead))
  if (rendererVisibleWidth(normalized) > available && available < MIN_MEANINGFUL_TRUNCATED_EXCERPT_WIDTH) return base
  const excerpt = label === "message"
    ? excerptRendererPromptText(normalized, available)
    : excerptRendererText(normalized, available)
  return `${prefix}${theme.italic(`"${excerpt}"`)}`
}

function optionalToken(label: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const normalized = normalizeRendererText(value)
  return normalized.length === 0 ? undefined : `${label}:${normalized}`
}

function taskSendResultRow(details: SendResultDetails): ResultRow {
  switch (details.kind) {
    case "steered":
      return {
        color: statusThemeColor(details.status),
        text: `task_send delivered ${details.task_id} as ${details.delivered} (${details.status})`,
      }
    case "revived":
      return { color: "success", text: `task_send revived ${details.task_id} epoch ${details.run_epoch}` }
    case "queued":
      return { color: "muted", text: `task_send queued ${details.task_id} position ${details.queue_position}` }
    case "not_continuable":
      return { color: "warning", text: `task_send not continuable ${details.task_id}: ${details.reason} ${details.suggestion}` }
    case "scope_denied":
      return { color: "error", text: `task_send denied ${details.task_id} owner:${details.owning_session_id}` }
    case "not_found":
      return { color: "error", text: notFoundText(details) }
    case "invalid_arguments":
      return { color: "error", text: `task_send invalid: ${details.reason}` }
    case "interrupted":
      return { color: "warning", text: `task_send interrupted ${details.task_id} (was ${details.previous_status})` }
    case "noop":
      return { color: statusThemeColor(details.previous_status), text: `task_send no change ${details.task_id} (${details.previous_status}): ${details.reason}` }
    case "team_message":
      return teamMessageRow(details.team)
    case "shutdown_requested":
      return { color: "warning", text: `task_send shutdown requested ${details.team_run_id} member:${details.member}` }
    case "shutdown_responded":
      return {
        color: details.approved ? "success" : "warning",
        text: `task_send shutdown ${details.approved ? "approved" : "rejected"} ${details.team_run_id} member:${details.member}`,
      }
    case "shutdown_failed":
      return {
        color: "error",
        text: `task_send shutdown ${details.operation} failed ${details.team_run_id} member:${details.member}: ${details.reason}`,
      }
    default:
      return assertNever(details)
  }
}

function notFoundText(details: Extract<SendResultDetails, { readonly kind: "not_found" }>): string {
  if (details.known_tasks.length === 0) return `task_send not found: ${details.reason}`
  return `task_send not found: ${details.reason} known:${details.known_tasks.join(",")}`
}

function teamMessageRow(details: Extract<SendResultDetails, { readonly kind: "team_message" }>["team"]): ResultRow {
  switch (details.kind) {
    case "to_lead":
      return { color: "success", text: `task_send team message ${details.message_id} enqueued to lead` }
    case "to_members":
      return {
        color: "success",
        text: `task_send team message ${details.message_id} enqueued to ${details.recipients.length} member(s)`,
      }
    case "recipient_backpressure":
    case "invalid_recipient":
    case "payload_too_large":
    case "broadcast_denied":
    case "team_deleting":
      return { color: "error", text: `task_send team ${details.kind} to:${details.to}: ${details.reason}` }
    default:
      return assertNever(details)
  }
}

function taskCancelResultRow(details: CancelResultDetails): ResultRow {
  switch (details.kind) {
    case "cancelled":
      return {
        color: statusThemeColor(details.status),
        text: `task_cancel cancelled ${details.task_id} (${details.previous_status} -> ${details.status})`,
      }
    case "noop":
      return { color: statusThemeColor(details.status), text: `task_cancel no change ${details.task_id} (${details.status}): ${details.reason}` }
    case "not_found":
      return { color: "error", text: `task_cancel not found: ${details.reason}` }
    case "invalid_arguments":
      return { color: "error", text: `task_cancel invalid: ${details.reason}` }
    default:
      return assertNever(details)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled control renderer variant: ${String(value)}`)
}
