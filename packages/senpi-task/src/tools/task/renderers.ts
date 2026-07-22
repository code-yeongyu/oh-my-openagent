import type { Theme, ThemeColor } from "@code-yeongyu/senpi"
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui"

import type { TaskToolDetails, TaskToolItemDetail } from "./types"
import { qualifyResolvedModelDisplay } from "./resolved-model-display"

const DEFAULT_EXCERPT_WIDTH = 120
const TASK_PROMPT_EXCERPT_WIDTH = 30
const TASK_REASON_EXCERPT_WIDTH = 40
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

export function rendererVisibleWidth(value: string): number {
  return visibleWidth(value)
}

export function normalizeRendererText(value: string): string {
  return stripTerminalControls(value).trim().replace(/\s+/gu, " ")
}

export function excerptRendererText(value: string, width = DEFAULT_EXCERPT_WIDTH): string {
  const normalized = normalizeRendererText(value)
  if (width <= 0) return ""
  return stripTerminalControls(truncateToWidth(normalized, width, ELLIPSIS))
}

export function excerptRendererPromptText(value: string, width = DEFAULT_EXCERPT_WIDTH): string {
  const normalized = normalizeRendererText(value)
  if (width <= 0) return ""
  if (rendererVisibleWidth(normalized) <= width) return normalized
  const contentWidth = Math.max(0, width - rendererVisibleWidth(ELLIPSIS))
  const clipped = truncateToWidth(normalized, contentWidth, "")
  const boundary = clipped.search(/\s+\S*$/u)
  if (boundary > 0) return `${clipped.slice(0, boundary).trimEnd()}${ELLIPSIS}`
  return stripTerminalControls(truncateToWidth(normalized, width, ELLIPSIS))
}

export function joinRendererTokens(tokens: readonly (string | undefined | false)[]): string {
  return tokens.filter((token) => typeof token === "string" && token.length > 0).join(" ")
}

export function formatTaskTarget(args: Pick<CallArgs, "category" | "subagent_type">): string {
  const category = optionalRendererText(args.category)
  if (category !== undefined) return `category:${category}`
  const agent = optionalRendererText(args.subagent_type)
  if (agent !== undefined) return `agent:${agent}`
  return "task"
}

export function formatTaskMode(runInBackground: boolean | undefined): string {
  return runInBackground === true ? "background" : "foreground"
}

export function formatTaskStatus(status: string): string {
  return normalizeRendererText(status)
}

export function formatResolvedModel(model: string | undefined): string | undefined {
  const normalized = optionalRendererText(model)
  return normalized === undefined ? undefined : `model:${normalized}`
}

export function taskCallLines(args: CallArgs): readonly string[] {
  return [taskCallLine(args, formatTaskMode(args.run_in_background))]
}

export function taskResultLines(details: TaskToolDetails): readonly string[] {
  const mode = details.run_in_background === undefined ? undefined : formatTaskMode(details.run_in_background)
  return [taskResultLine(details, mode), ...(details.items ?? []).map(taskItemResultLine)]
}

export function renderTaskCallLines(args: CallArgs, theme: RendererTheme): readonly string[] {
  return [taskCallLine(args, theme.italic(formatTaskMode(args.run_in_background)))]
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

function stripTerminalControls(value: string): string {
  let text = ""
  let index = 0

  while (index < value.length) {
    const code = value.charCodeAt(index)
    if (code === 0x1b) {
      index = skipEscapeSequence(value, index)
      continue
    }
    if (code === 0x9b) {
      index = skipCsi(value, index + 1)
      continue
    }
    if (code === 0x90 || code === 0x98 || code === 0x9d || code === 0x9e || code === 0x9f) {
      index = skipControlString(value, index + 1, code === 0x9d)
      continue
    }
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      if (code >= 0x09 && code <= 0x0d) text += " "
      index++
      continue
    }
    text += value.charAt(index)
    index++
  }

  return text
}

function skipEscapeSequence(value: string, escapeIndex: number): number {
  const nextIndex = escapeIndex + 1
  if (nextIndex >= value.length) return value.length

  const next = value.charCodeAt(nextIndex)
  if (next === 0x5b) return skipCsi(value, nextIndex + 1)
  if (next === 0x50 || next === 0x58 || next === 0x5d || next === 0x5e || next === 0x5f) {
    return skipControlString(value, nextIndex + 1, next === 0x5d)
  }

  let index = nextIndex
  while (index < value.length && value.charCodeAt(index) >= 0x20 && value.charCodeAt(index) <= 0x2f) index++
  if (index < value.length && value.charCodeAt(index) >= 0x30 && value.charCodeAt(index) <= 0x7e) return index + 1
  return nextIndex
}

function skipCsi(value: string, startIndex: number): number {
  for (let index = startIndex; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code >= 0x40 && code <= 0x7e) return index + 1
  }
  return value.length
}

function skipControlString(value: string, startIndex: number, bellTerminates: boolean): number {
  for (let index = startIndex; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (bellTerminates && code === 0x07) return index + 1
    if (code === 0x9c) return index + 1
    if (code === 0x1b && value.charCodeAt(index + 1) === 0x5c) return index + 2
  }
  return value.length
}

function optionalRendererText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const normalized = normalizeRendererText(value)
  return normalized.length > 0 ? normalized : undefined
}

function taskTargetToken(args: Pick<CallArgs, "category" | "subagent_type">): string | undefined {
  const target = formatTaskTarget(args)
  return target === "task" ? undefined : target
}

function promptToken(prompt: string | undefined): string | undefined {
  const normalized = optionalRendererText(prompt)
  if (normalized === undefined) return undefined
  return `"${excerptRendererPromptText(normalized, TASK_PROMPT_EXCERPT_WIDTH)}"`
}

function taskCallLine(args: CallArgs, mode: string): string {
  return joinRendererTokens(["task", taskTargetToken(args), promptToken(args.prompt), mode])
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
