import type { Theme, ThemeColor } from "@code-yeongyu/senpi"
import { truncateToWidth } from "@earendil-works/pi-tui"

import type { TaskToolDetails, TaskToolItemDetail } from "./types"
import {
  formatTaskMode,
  formatTaskTarget,
  renderTaskCallLines,
  taskCallLines,
} from "./call-renderer"
import {
  ELLIPSIS,
  excerptRendererText,
  joinRendererTokens,
  normalizeRendererText,
  optionalRendererText,
  rendererVisibleWidth,
} from "./renderer-text"
import { qualifyResolvedModelDisplay } from "./resolved-model-display"

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
}

export function statusThemeColor(status: string): ThemeColor {
  return Object.hasOwn(STATUS_COLORS, status) ? STATUS_COLORS[status] : "muted"
}

export function formatTaskStatus(status: string): string {
  return normalizeRendererText(status)
}

export function formatResolvedModel(model: string | undefined): string | undefined {
  const normalized = optionalRendererText(model)
  return normalized === undefined ? undefined : `model:${normalized}`
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

function taskTargetToken(args: Pick<TaskToolDetails, "category" | "subagent_type">): string | undefined {
  const target = formatTaskTarget(args)
  return target === "task" ? undefined : target
}

function resolvedModelToken(details: TaskToolDetails): string | undefined {
  const resolved = details.resolved_model
  if (resolved === undefined) return formatResolvedModel(details.model)

  const display = optionalRendererText(resolved.display) ?? formatResolvedModel(details.model)
  const qualifiedDisplay = qualifyResolvedModelDisplay(optionalRendererText(resolved.provider), display)
  const reasoning = optionalRendererText(resolved.reasoning_effort)
  const variant = usefulVariant(optionalRendererText(resolved.variant), reasoning, display)
  const content = joinRendererTokens([qualifiedDisplay, reasoning === undefined ? undefined : `reasoning:${reasoning}`,
    variant === undefined ? undefined : `variant:${variant}`,
  ])
  return content.length > 0 ? `(${content})` : undefined
}

function usefulVariant(
  variant: string | undefined,
  reasoning: string | undefined,
  display: string | undefined,
): string | undefined {
  if (variant === undefined) return undefined
  const comparable = variant.toLocaleLowerCase()
  if (reasoning?.toLocaleLowerCase() === comparable) return undefined
  if (display?.toLocaleLowerCase().includes(comparable) === true) return undefined
  return variant
}

function taskResultLine(details: TaskToolDetails, mode: string | undefined): string {
  const taskId = optionalRendererText(details.task_id)
  const reason = optionalRendererText(details.reason)
  return joinRendererTokens([
    "task",
    taskTargetToken(details),
    resolvedModelToken(details),
    mode,
    formatTaskStatus(details.status),
    taskId === undefined ? undefined : `id:${taskId}`,
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
    formatTaskStatus(item.status),
    taskId === undefined ? undefined : `id:${taskId}`,
    item.queue_position === undefined ? undefined : `queue:${item.queue_position}`,
    error === undefined ? undefined : `error:${excerptRendererText(error, TASK_REASON_EXCERPT_WIDTH)}`,
  ])
}

function taskResultLineForWidth(details: TaskToolDetails, mode: string | undefined, width: number): string {
  const requiredWithoutModel = [
    "task",
    taskTargetToken(details),
    mode,
    formatTaskStatus(details.status),
  ].filter((token): token is string => token !== undefined)
  const requiredSpaces = requiredWithoutModel.length
  const modelWidth = Math.max(
    0,
    width - requiredWithoutModel.reduce((total, token) => total + rendererVisibleWidth(token), 0) - requiredSpaces,
  )
  const required = [
    "task",
    taskTargetToken(details),
    compactResolvedModelToken(details, modelWidth),
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

function compactResolvedModelToken(details: TaskToolDetails, maxWidth: number): string | undefined {
  const resolved = details.resolved_model
  if (resolved === undefined) return formatResolvedModel(details.model)
  const reasoning = optionalRendererText(resolved.reasoning_effort)
  const display = optionalRendererText(resolved.display)
  const qualifiedDisplay = qualifyResolvedModelDisplay(optionalRendererText(resolved.provider), display)
  const candidates = [qualifiedDisplay, `${resolved.provider}/${resolved.model_id}`, resolved.model_id, details.model]
    .map(optionalRendererText)
    .filter((candidate): candidate is string => candidate !== undefined)
  for (const candidate of candidates) {
    const token = `(${joinRendererTokens([candidate, reasoning])})`
    if (rendererVisibleWidth(token) <= maxWidth) return token
  }
  const shortest = candidates.toSorted((left, right) => rendererVisibleWidth(left) - rendererVisibleWidth(right))[0]
  if (shortest === undefined) return undefined
  return `(${excerptRendererText(joinRendererTokens([shortest, reasoning]), Math.max(0, maxWidth - 2))})`
}

function taskResultOptionalTokens(details: TaskToolDetails): readonly string[] {
  const taskId = optionalRendererText(details.task_id)
  const reason = optionalRendererText(details.reason)
  return [
    taskId === undefined ? undefined : `id:${taskId}`,
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
} from "./renderer-text"
export {
  formatTaskMode,
  formatTaskTarget,
  renderTaskCallLines,
  taskCallLines,
} from "./call-renderer"
