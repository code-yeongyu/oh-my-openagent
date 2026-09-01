import type { AgentToolResult, Theme, ThemeColor, ToolRenderResultOptions } from "@code-yeongyu/senpi"

import { formatStatusTarget, taskIdentityLabel } from "../../status-line"
import {
  excerptRendererText,
  joinRendererTokens,
  linesComponent,
  normalizeRendererText,
  rendererVisibleWidth,
  statusThemeColor,
} from "../task/renderers"
import { runStatsSuffix } from "../run-stats-format"
import type { TaskOutputInput } from "./output"
import type { TaskOutputDetails, TaskSnapshot } from "./types"

export type OutputRenderTheme = Pick<Theme, "fg">

type RenderComponent = {
  render(width: number): string[]
  invalidate(): void
}

type ResultRow = {
  readonly color: ThemeColor
  readonly text: string
}

const DEFAULT_TAIL_LINES = 60
const TARGET_EXCERPT_MAX = 56

export function renderTaskOutputCall(args: TaskOutputInput, theme: OutputRenderTheme): RenderComponent {
  return {
    render: (width: number): string[] => linesComponent([theme.fg("toolTitle", taskOutputCallLine(args, width))]).render(width),
    invalidate: (): void => {},
  }
}

export function renderTaskOutputResult(
  result: AgentToolResult<TaskOutputDetails>,
  _options: ToolRenderResultOptions,
  theme: OutputRenderTheme,
): RenderComponent {
  const row = taskOutputResultRow(result.details)
  return linesComponent([theme.fg(row.color, normalizeRendererText(row.text))])
}

function taskOutputCallLine(args: TaskOutputInput, width: number): string {
  const mode = args.mode ?? "status"
  const tail = mode === "tail" ? `tail_lines:${args.tail_lines ?? DEFAULT_TAIL_LINES}` : undefined
  const beforeTarget = "task_output target:"
  const afterTarget = joinRendererTokens([`mode:${mode}`, "peek", tail])
  const available = Math.min(TARGET_EXCERPT_MAX, Math.max(0, width - rendererVisibleWidth(beforeTarget) - rendererVisibleWidth(afterTarget) - 1))
  const target = excerptRendererText(args.task_id ?? args.name ?? "<missing>", available)
  return joinRendererTokens([`${beforeTarget}${target}`, afterTarget])
}

function taskOutputResultRow(details: TaskOutputDetails): ResultRow {
  switch (details.kind) {
    case "status": {
      const identity = snapshotIdentity(details.snapshot)
      const idSuffix = identity === details.snapshot.task_id ? undefined : `(${details.snapshot.task_id})`
      const target =
        formatStatusTarget({
          category: details.snapshot.category,
          agentType: details.snapshot.agent_type,
          resolvedModel: details.snapshot.resolved_model,
        }) ?? `model:${normalizeRendererText(details.snapshot.model)}`
      const statusLabel = details.snapshot.suspended !== undefined ? "suspended" : normalizeRendererText(details.snapshot.status)
      return {
        color: statusThemeColor(details.snapshot.status),
        text: `${joinRendererTokens([`task_output ${identity}`, idSuffix, statusLabel])} · ${target}${runStatsSuffix(details.snapshot.run_stats)}`,
      }
    }
    case "transcript":
      return {
        color: statusThemeColor(details.snapshot.status),
        text: joinRendererTokens([
          `task_output transcript ${snapshotIdentity(details.snapshot)}`,
          `mode:${details.mode}`,
          `source:${details.source}`,
          details.truncated ? "truncated" : undefined,
        ]),
      }
    case "not_found":
      return { color: "error", text: notFoundRow(details) }
    case "invalid_arguments":
      return { color: "error", text: `task_output invalid: ${details.reason}` }
    default:
      return assertNever(details)
  }
}

function notFoundRow(details: Extract<TaskOutputDetails, { readonly kind: "not_found" }>): string {
  const known = details.known_tasks.length > 0 ? `known:${excerptRendererText(details.known_tasks.join(","))}` : undefined
  return joinRendererTokens([`task_output not found: ${details.reason}`, known])
}

// Model-facing model summary for the task_output status view text (TUI rows use formatStatusTarget).
export function taskOutputModelText(snapshot: TaskSnapshot): string {
  const display = nonEmpty(snapshot.resolved_model?.display)
  const model = normalizeRendererText(snapshot.model)
  const reasoning = nonEmpty(snapshot.resolved_model?.reasoning) ?? nonEmpty(snapshot.resolved_model?.reasoning_effort)
  const variant = nonEmpty(snapshot.resolved_model?.variant)
  const details = [
    reasoning === undefined ? undefined : `reasoning ${reasoning}`,
    variant === undefined ? undefined : `variant ${variant}`,
  ].filter((part) => part !== undefined)
  return `model ${display ?? model}${details.length > 0 ? ` (${details.join(", ")})` : ""}`
}

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value === undefined ? undefined : excerptRendererText(value)
  return normalized !== undefined && normalized.length > 0 ? normalized : undefined
}

function snapshotIdentity(snapshot: TaskSnapshot): string {
  return taskIdentityLabel({
    taskId: snapshot.task_id,
    name: snapshot.name,
    description: snapshot.description,
    taskSummary: snapshot.task_summary,
  })
}

function assertNever(value: never): never {
  throw new Error(`Unhandled task_output renderer variant: ${String(value)}`)
}
