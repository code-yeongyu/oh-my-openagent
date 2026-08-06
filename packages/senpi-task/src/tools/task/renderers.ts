import type { Theme, ThemeColor } from "@code-yeongyu/senpi"
import { truncateToWidth } from "@earendil-works/pi-tui"

import type { TaskToolDetails, TaskToolItemDetail } from "./types"
import {
  formatTaskMode,
  renderTaskCallLines,
  taskCallLines,
} from "./call-renderer"
import { formatTargetWithModel } from "../../status-line"
import {
  ELLIPSIS,
  excerptRendererText,
  joinRendererTokens,
  normalizeRendererText,
  optionalRendererText,
  rendererVisibleWidth,
} from "../../renderer-text"
import { runStatsResultTokens } from "../run-stats-format"

const TASK_REASON_EXCERPT_WIDTH = 40

type LinesComponent = {
  render(width: number): string[]
  invalidate(): void
}

type WidthAwareLines = (width: number) => readonly string[]

type RendererTheme = Pick<Theme, "fg" | "italic">

const STATUS_COLORS: Readonly<Record<string, ThemeColor>> = {
  completed: "success",
  error: "error",
  lost: "error",
  cancelled: "warning",
  interrupted: "warning",
  running: "accent",
  pending: "muted",
  invalid_arguments: "error",
}

export function statusThemeColor(status: string): ThemeColor {
  return Object.hasOwn(STATUS_COLORS, status) ? STATUS_COLORS[status] : "muted"
}

export function formatTaskStatus(status: string): string {
  return normalizeRendererText(status)
}

export function taskResultLines(details: TaskToolDetails): readonly string[] {
  const mode = details.run_in_background === undefined ? undefined : formatTaskMode(details.run_in_background)
  return [taskResultLine(details, mode), ...(details.items ?? []).map(taskItemResultLine)]
}

export function renderTaskResultLines(details: TaskToolDetails, theme: RendererTheme): readonly string[] {
  const mode = details.run_in_background === undefined ? undefined : theme.italic(formatTaskMode(details.run_in_background))
  return [taskResultLine(details, mode), ...(details.items ?? []).map(taskItemResultLine)]
}

export function renderTaskResultComponent(details: TaskToolDetails, theme: RendererTheme): LinesComponent {
  return {
    render: (width: number): string[] => {
      if (width <= 0) return [""]
      const mode = details.run_in_background === undefined ? undefined : theme.italic(formatTaskMode(details.run_in_background))
      const line = taskResultLineForWidth(details, mode, width)
      const aggregate = truncateToWidth(theme.fg(statusThemeColor(details.status), line), width, ELLIPSIS)
      const items = (details.items ?? []).map((item) =>
        truncateToWidth(theme.fg(statusThemeColor(item.status), taskItemResultLine(item)), width, ELLIPSIS),
      )
      return [aggregate, ...items]
    },
    invalidate: (): void => {},
  }
}

export function linesComponent(lines: readonly string[] | WidthAwareLines): LinesComponent {
  return {
    render: (width: number): string[] => {
      const widthAware = typeof lines === "function"
      const renderedLines = widthAware ? lines(width) : lines
      return renderedLines.map((line) => {
        if (width <= 0) return ""
        return widthAware ? line : truncateToWidth(line, width, ELLIPSIS)
      })
    },
    invalidate: (): void => {},
  }
}

type TargetIdentity = Pick<TaskToolDetails, "category" | "subagent_type" | "model" | "resolved_model">

// One target token per row, in the shared status-line grammar: `category:<n>(<model>:<effort>)` |
// `agent:<n>(<model>:<effort>)` | `model:<m>`. No site composes its own agent/category branch.
function taskTargetToken(details: TargetIdentity): string | undefined {
  const target = formatTargetWithModel({
    category: details.category,
    agentType: details.subagent_type,
    resolvedModel: details.resolved_model,
    model: details.model,
  })
  return target === "task" ? undefined : target
}

function fallbackCountToken(details: Pick<TaskToolDetails, "fallback_attempts">): string | undefined {
  const count = details.fallback_attempts?.length ?? 0
  return count > 0 ? `fallback:${count}` : undefined
}

function taskResultLine(details: TaskToolDetails, mode: string | undefined): string {
  const taskId = optionalRendererText(details.task_id)
  const reason = optionalRendererText(details.reason)
  return joinRendererTokens([
    "task",
    taskTargetToken(details),
    fallbackCountToken(details),
    mode,
    formatTaskStatus(details.status),
    taskId === undefined ? undefined : `id:${taskId}`,
    ...runStatsResultTokens(details.run_stats),
    details.queue_position === undefined ? undefined : `queue:${details.queue_position}`,
    reason === undefined ? undefined : `reason:${excerptRendererText(reason, TASK_REASON_EXCERPT_WIDTH)}`,
  ])
}

function taskItemResultLine(item: TaskToolItemDetail): string {
  const taskId = optionalRendererText(item.task_id)
  const name = optionalRendererText(item.name)
  const error = optionalRendererText(item.error_message)
  return joinRendererTokens([
    "item",
    name === undefined ? undefined : `name:${name}`,
    taskTargetToken(item),
    formatTaskStatus(item.status),
    taskId === undefined ? undefined : `id:${taskId}`,
    item.queue_position === undefined ? undefined : `queue:${item.queue_position}`,
    error === undefined ? undefined : `error:${excerptRendererText(error, TASK_REASON_EXCERPT_WIDTH)}`,
  ])
}

function taskResultLineForWidth(details: TaskToolDetails, mode: string | undefined, width: number): string {
  const requiredWithoutTarget = [
    "task",
    fallbackCountToken(details),
    mode,
    formatTaskStatus(details.status),
  ].filter((token): token is string => token !== undefined)
  const requiredSpaces = requiredWithoutTarget.length + 1
  const targetWidth = Math.max(
    0,
    width - requiredWithoutTarget.reduce((total, token) => total + rendererVisibleWidth(token), 0) - requiredSpaces,
  )
  const required = [
    "task",
    compactTargetToken(details, targetWidth),
    fallbackCountToken(details),
    mode,
    formatTaskStatus(details.status),
  ].filter((token): token is string => token !== undefined)
  let line = required.join(" ")

  for (const token of taskResultOptionalTokens(details)) {
    const candidate = `${line} ${token}`
    if (rendererVisibleWidth(candidate) > width) break
    line = candidate
  }
  return line
}

function compactTargetToken(details: TargetIdentity, maxWidth: number): string | undefined {
  const token = taskTargetToken(details)
  if (token === undefined || rendererVisibleWidth(token) <= maxWidth) return token
  return excerptRendererText(token, maxWidth)
}

function taskResultOptionalTokens(details: TaskToolDetails): readonly string[] {
  const taskId = optionalRendererText(details.task_id)
  const reason = optionalRendererText(details.reason)
  return [
    taskId === undefined ? undefined : `id:${taskId}`,
    ...runStatsResultTokens(details.run_stats),
    details.queue_position === undefined ? undefined : `queue:${details.queue_position}`,
    reason === undefined ? undefined : `reason:${excerptRendererText(reason, TASK_REASON_EXCERPT_WIDTH)}`,
  ].filter((token): token is string => token !== undefined)
}

export {
  excerptRendererText,
  excerptRendererPromptText,
  joinRendererTokens,
  normalizeRendererText,
  rendererVisibleWidth,
} from "../../renderer-text"
export {
  formatTaskMode,
  formatTaskTarget,
  renderTaskCallLines,
  taskCallLines,
} from "./call-renderer"
