import type { Theme, ThemeColor } from "@code-yeongyu/senpi"
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui"

import type { TaskToolDetails } from "./types"

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
  return [taskResultLine(details, mode)]
}

export function renderTaskCallLines(args: CallArgs, theme: RendererTheme): readonly string[] {
  return [taskCallLine(args, theme.italic(formatTaskMode(args.run_in_background)))]
}

export function renderTaskResultLines(details: TaskToolDetails, theme: RendererTheme): readonly string[] {
  const mode = details.run_in_background === undefined ? undefined : theme.italic(formatTaskMode(details.run_in_background))
  return [taskResultLine(details, mode)]
}

export function linesComponent(lines: readonly string[]): LinesComponent {
  return {
    render: (width: number): string[] => lines.map((line) => excerptRendererText(line, width)),
    invalidate: (): void => {},
  }
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
  return `"${excerptRendererText(normalized, TASK_PROMPT_EXCERPT_WIDTH)}"`
}

function taskCallLine(args: CallArgs, mode: string): string {
  return joinRendererTokens(["task", taskTargetToken(args), promptToken(args.prompt), mode])
}

function resolvedModelToken(details: TaskToolDetails): string | undefined {
  const resolved = details.resolved_model
  if (resolved === undefined) return formatResolvedModel(details.model)

  const display = optionalRendererText(resolved.display) ?? formatResolvedModel(details.model)
  const reasoning = optionalRendererText(resolved.reasoning_effort)
  const variant = usefulVariant(optionalRendererText(resolved.variant), reasoning, display)
  const content = joinRendererTokens([
    display,
    reasoning === undefined ? undefined : `reasoning:${reasoning}`,
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
