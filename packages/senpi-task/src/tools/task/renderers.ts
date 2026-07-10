import type { ThemeColor } from "@code-yeongyu/senpi"
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui"

import type { TaskToolDetails } from "./types"

const DEFAULT_EXCERPT_WIDTH = 120
const ELLIPSIS = "..."

type CallArgs = {
  readonly prompt?: string
  readonly category?: string
  readonly subagent_type?: string
  readonly run_in_background?: boolean
}

type LinesComponent = {
  render(width: number): string[]
  invalidate(): void
}

export type StructuredSendMessageSummary =
  | {
      readonly type: "shutdown_request"
      readonly reason?: string
    }
  | {
      readonly type: "shutdown_response"
      readonly approve: boolean
      readonly reason?: string
    }

const STATUS_COLORS: Readonly<Record<string, ThemeColor>> = {
  completed: "success",
  error: "error",
  lost: "error",
  cancelled: "warning",
  interrupted: "warning",
  running: "accent",
  pending: "muted",
}

export function statusThemeColor(status: string): ThemeColor {
  return Object.hasOwn(STATUS_COLORS, status) ? STATUS_COLORS[status] : "muted"
}

export function rendererVisibleWidth(value: string): number {
  return visibleWidth(value)
}

export function normalizeRendererText(value: string): string {
  return value.trim().replace(/\s+/gu, " ")
}

export function excerptRendererText(value: string, width = DEFAULT_EXCERPT_WIDTH): string {
  const normalized = normalizeRendererText(value)
  if (width <= 0) return ""
  return truncateToWidth(normalized, width, ELLIPSIS)
}

export function joinRendererTokens(tokens: readonly (string | undefined | false)[]): string {
  return tokens.filter((token) => typeof token === "string" && token.length > 0).join(" ")
}

export function formatTaskTarget(args: Pick<CallArgs, "category" | "subagent_type">): string {
  if (args.category !== undefined) return `category:${normalizeRendererText(args.category)}`
  if (args.subagent_type !== undefined) return `agent:${normalizeRendererText(args.subagent_type)}`
  return "task"
}

export function formatTaskMode(runInBackground: boolean | undefined): string {
  return runInBackground === true ? "background" : "foreground"
}

export function formatTaskStatus(status: string): string {
  return normalizeRendererText(status)
}

export function formatResolvedModel(model: string | undefined): string | undefined {
  if (model === undefined) return undefined
  const normalized = normalizeRendererText(model)
  return normalized.length > 0 ? `model:${normalized}` : undefined
}

export function formatSendMessageSummary(message: string | StructuredSendMessageSummary, width = DEFAULT_EXCERPT_WIDTH): string {
  if (typeof message === "string") return excerptRendererText(message, width)

  switch (message.type) {
    case "shutdown_request":
      return joinRendererTokens(["shutdown request", message.reason === undefined ? undefined : excerptRendererText(message.reason, width)])
    case "shutdown_response":
      return joinRendererTokens([
        message.approve ? "shutdown approved" : "shutdown rejected",
        message.reason === undefined ? undefined : excerptRendererText(message.reason, width),
      ])
  }
}

export function taskCallLines(args: CallArgs): readonly string[] {
  const target = formatTaskTarget(args)
  const mode = formatTaskMode(args.run_in_background)
  return [`${target} (${mode})`]
}

export function taskResultLines(details: TaskToolDetails): readonly string[] {
  const status = formatTaskStatus(details.status)
  const model = formatResolvedModel(details.model)
  return [joinRendererTokens([`task ${details.task_id}:`, status, model])]
}

export function linesComponent(lines: readonly string[]): LinesComponent {
  return {
    render: (width: number): string[] => lines.map((line) => excerptRendererText(line, width)),
    invalidate: (): void => {},
  }
}
