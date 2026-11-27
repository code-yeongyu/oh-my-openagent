import type { Theme, ThemeColor } from "@code-yeongyu/senpi"

import { piTui } from "../../lazy/pi-tui"
import type { TaskToolDetails, TaskToolItemDetail } from "./types"
import { formatTaskMode } from "./call-renderer"
import { formatTargetWithModel } from "../../status-line"
import { priorityAliasBaseId } from "../../runners/pinned-model-equivalence"
import { splitModelDecorators } from "../../senpi/explicit-pin"
import {
  ELLIPSIS,
  excerptRendererText,
  joinRendererTokens,
  normalizeRendererText,
  optionalRendererText,
  rendererVisibleWidth,
} from "../../renderer-text"
import { runStatsCardSummary } from "../run-stats-format"

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
  return details.items?.length ? details.items.map(taskItemResultLine) : [taskResultLine(details, mode)]
}

export function renderTaskResultLines(details: TaskToolDetails, theme: RendererTheme): readonly string[] {
  const mode =
    details.run_in_background === undefined ? undefined : theme.italic(formatTaskMode(details.run_in_background))
  return details.items?.length ? details.items.map(taskItemResultLine) : [taskResultLine(details, mode)]
}

export function renderTaskResultComponent(details: TaskToolDetails, theme: RendererTheme): LinesComponent {
  const { truncateToWidth } = piTui()
  return {
    render: (width: number): string[] => {
      if (width <= 0) return [""]
      const mode =
        details.run_in_background === undefined ? undefined : theme.italic(formatTaskMode(details.run_in_background))
      if (details.items?.length) {
        return details.items.map((item) =>
          truncateToWidth(theme.fg(statusThemeColor(item.status), taskItemResultLineForWidth(item, width)), width, ELLIPSIS),
        )
      }
      const line = taskResultLineForWidth(details, mode, width)
      const aggregate = truncateToWidth(theme.fg(statusThemeColor(details.status), line), width, ELLIPSIS)
      return [aggregate]
    },
    invalidate: (): void => {},
  }
}

export function linesComponent(lines: readonly string[] | WidthAwareLines): LinesComponent {
  const { truncateToWidth } = piTui()
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

function taskDowngradeToken(details: TaskToolDetails): string | undefined {
  const effective = details.effective_model
  const tier = optionalRendererText(effective?.service_tier)
  if (effective === undefined || tier === undefined || tier === "priority") return undefined
  const resolved = details.resolved_model
  const { base: pin } = splitModelDecorators(details.model ?? "")
  const separator = pin.indexOf("/")
  const provider = resolved?.provider ?? pin.slice(0, separator)
  const id = resolved?.model_id ?? pin.slice(separator + 1)
  const baseId = priorityAliasBaseId(id)
  if (baseId === undefined || effective.provider !== provider) return undefined
  if (effective.model_id !== id && effective.model_id !== baseId) return undefined
  // Legacy records lack catalog tier metadata; a successful alias-to-base start proves pairing.
  if (resolved?.service_tier !== "priority" && effective.model_id !== baseId) return undefined
  return `tier:${tier}`
}

function taskIdToken(details: Pick<TaskToolDetails, "task_id">): string | undefined {
  const id = optionalRendererText(details.task_id)
  return id === undefined ? undefined : `id:${id}`
}

function taskResultLine(details: TaskToolDetails, mode: string | undefined): string {
  const reason = optionalRendererText(details.reason)
  const summary = runStatsCardSummary(details.run_stats)
  return (
    joinRendererTokens([
      "task",
      taskTargetToken(details),
      taskDowngradeToken(details),
      fallbackCountToken(details),
      mode,
      formatTaskStatus(details.status),
      optionalRendererText(details.nickname),
      taskIdToken(details),
      details.queue_position === undefined ? undefined : `queue:${details.queue_position}`,
      reason === undefined ? undefined : `reason:${excerptRendererText(reason, TASK_REASON_EXCERPT_WIDTH)}`,
    ]) + summary
  )
}

function taskItemResultLine(item: TaskToolItemDetail): string {
  const name = optionalRendererText(item.name)
  const error = optionalRendererText(item.error_message)
  const id = optionalRendererText(item.task_id)
  return joinRendererTokens([
    name === undefined || name === id ? undefined : `name:${name}`,
    optionalRendererText(item.nickname),
    taskIdToken(item),
    taskTargetToken(item),
    formatTaskStatus(item.status),
    item.queue_position === undefined ? undefined : `queue:${item.queue_position}`,
    error === undefined ? undefined : `error:${excerptRendererText(error, TASK_REASON_EXCERPT_WIDTH)}`,
  ])
}

function taskResultLineForWidth(details: TaskToolDetails, mode: string | undefined, width: number): string {
  const nickname = optionalRendererText(details.nickname)
  let line: string
  if (nickname === undefined) {
    const requiredWithoutTarget = [
      "task",
      taskDowngradeToken(details),
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
      taskDowngradeToken(details),
      fallbackCountToken(details),
      mode,
      formatTaskStatus(details.status),
    ].filter((token): token is string => token !== undefined)
    line = required.join(" ")
    const optional = [taskIdToken(details), ...taskResultTrailingTokens(details)].filter(
      (token): token is string => token !== undefined,
    )
    for (const token of optional) {
      const candidate = `${line} ${token}`
      if (rendererVisibleWidth(candidate) > width) break
      line = candidate
    }
  } else {
    line = taskResultNicknameLineForWidth(details, mode, nickname, width)
  }
  const summary = runStatsCardSummary(details.run_stats)
  if (summary.length > 0 && rendererVisibleWidth(`${line}${summary}`) <= width) {
    line = `${line}${summary}`
  }
  return line
}

function taskResultNicknameLineForWidth(
  details: TaskToolDetails,
  mode: string | undefined,
  nickname: string,
  width: number,
): string {
  const id = widthLimitedToken(taskIdToken(details), width)
  const label = widthLimitedToken(nickname, remainingRendererWidth(id ?? "", width))
  let budget = joinRendererTokens([label, id])
  const fit = (token: string | undefined): string | undefined => {
    if (token === undefined || rendererVisibleWidth(token) > remainingRendererWidth(budget, width)) return undefined
    budget = joinRendererTokens([budget, token])
    return token
  }
  const status = fit(formatTaskStatus(details.status))
  const prefix = fit("task")
  const fittedMode = fit(mode)
  const tier = fit(taskDowngradeToken(details))
  const fallback = fit(fallbackCountToken(details))
  const target = widthLimitedToken(taskTargetToken(details), remainingRendererWidth(budget, width))
  let line = joinRendererTokens([prefix, target, tier, fallback, fittedMode, status, label, id])
  for (const token of taskResultTrailingTokens(details)) line = appendCompactToken(line, token, width, token.startsWith("reason:"))
  return line
}

function compactTargetToken(details: TargetIdentity, maxWidth: number): string | undefined {
  const token = taskTargetToken(details)
  if (token === undefined || rendererVisibleWidth(token) <= maxWidth) return token
  return excerptRendererText(token, maxWidth)
}

function taskItemResultLineForWidth(item: TaskToolItemDetail, width: number): string {
  const idToken = widthLimitedToken(taskIdToken(item), width)
  const nickname = optionalRendererText(item.nickname)
  const nicknameToken = widthLimitedToken(nickname, remainingRendererWidth(idToken ?? "", width))
  let line = joinRendererTokens([nicknameToken, idToken])
  const status = formatTaskStatus(item.status)
  const statusFits = rendererVisibleWidth(status) <= remainingRendererWidth(line, width)
  const contentWidth = statusFits ? width - rendererVisibleWidth(status) - (line.length > 0 ? 1 : 0) : width
  const name = optionalRendererText(item.name)
  if (name !== undefined && name !== optionalRendererText(item.task_id)) {
    line = appendCompactToken(line, `name:${name}`, contentWidth, true)
  }
  line = appendCompactToken(line, taskTargetToken(item), contentWidth, true)
  if (statusFits) line = joinRendererTokens([line, status])
  if (item.queue_position !== undefined) line = appendCompactToken(line, `queue:${item.queue_position}`, width)
  const error = optionalRendererText(item.error_message)
  if (error !== undefined) line = appendCompactToken(line, `error:${error}`, width, true)
  return line
}

function taskResultTrailingTokens(details: TaskToolDetails): readonly string[] {
  const reason = optionalRendererText(details.reason)
  return [
    details.queue_position === undefined ? undefined : `queue:${details.queue_position}`,
    reason === undefined ? undefined : `reason:${excerptRendererText(reason, TASK_REASON_EXCERPT_WIDTH)}`,
  ].filter((token): token is string => token !== undefined)
}

function widthLimitedToken(token: string | undefined, maxWidth: number): string | undefined {
  if (token === undefined || maxWidth <= 0) return undefined
  return rendererVisibleWidth(token) <= maxWidth ? token : excerptRendererText(token, maxWidth)
}

function remainingRendererWidth(line: string, width: number): number {
  return Math.max(0, width - rendererVisibleWidth(line) - (line.length > 0 ? 1 : 0))
}

function appendCompactToken(line: string, token: string | undefined, width: number, clip = false): string {
  if (token === undefined) return line
  const available = remainingRendererWidth(line, width)
  if (rendererVisibleWidth(token) <= available) return joinRendererTokens([line, token])
  if (!clip || available <= 0) return line
  return joinRendererTokens([line, excerptRendererText(token, available)])
}

export {
  excerptRendererText,
  excerptRendererPromptText,
  joinRendererTokens,
  normalizeRendererText,
  rendererVisibleWidth,
} from "../../renderer-text"
export { formatTaskMode, formatTaskTarget, renderTaskCallLines, taskCallLines } from "./call-renderer"
