import type { Theme, ThemeColor, ToolRenderResultOptions } from "@code-yeongyu/senpi"

import { piTui } from "../../lazy/pi-tui"
import {
  ELLIPSIS,
  excerptRendererText,
  joinRendererTokens,
  normalizeRendererText,
  optionalRendererText,
} from "../../renderer-text"
import { formatTargetWithModel } from "../../status-line"
import { statusThemeColor } from "../task/renderers"
import type { ToolExecutionResult } from "../control"
import type { TeamCreateDetails, TeamCreateInput, TeamCreateMemberView, TeamDeleteDetails, TeamDeleteInput } from "./lifecycle"
import type {
  TeamTaskCreateDetails,
  TeamTaskCreateInput,
  TeamTaskGetDetails,
  TeamTaskGetInput,
  TeamTaskListDetails,
  TeamTaskListInput,
  TeamTaskUpdateDetails,
  TeamTaskUpdateInput,
} from "./tasks"

export type TeamRenderTheme = Pick<Theme, "fg" | "italic">

export type TeamTaskOperation = "create" | "get" | "list" | "update"

export type TeamTaskCallInput = TeamTaskCreateInput | TeamTaskGetInput | TeamTaskListInput | TeamTaskUpdateInput
export type TeamTaskDetails = TeamTaskCreateDetails | TeamTaskGetDetails | TeamTaskListDetails | TeamTaskUpdateDetails

type RenderComponent = {
  render(width: number): string[]
  invalidate(): void
}

type Row = { readonly color: ThemeColor; readonly text: string }

const SUBJECT_EXCERPT_MAX = 48
const REASON_EXCERPT_MAX = 120

function component(rows: readonly Row[], theme: TeamRenderTheme): RenderComponent {
  const { truncateToWidth } = piTui()
  return {
    render: (width: number): string[] => {
      if (width <= 0) return rows.map(() => "")
      return rows.map((row) => truncateToWidth(theme.fg(row.color, row.text), width, ELLIPSIS))
    },
    invalidate: (): void => {},
  }
}

function callComponent(text: string, theme: TeamRenderTheme): RenderComponent {
  return component([{ color: "toolTitle", text }], theme)
}

function token(label: string, value: string | undefined): string | undefined {
  const normalized = optionalRendererText(value)
  return normalized === undefined ? undefined : `${label}:${normalized}`
}

function excerptToken(label: string, value: string | undefined, width: number): string | undefined {
  const normalized = optionalRendererText(value)
  return normalized === undefined ? undefined : `${label}:${excerptRendererText(normalized, width)}`
}

// The model may pass inline_spec as an object or as a JSON string of that object; the row reports
// what the call asked for, so an unparseable string degrades to the spec token instead of throwing.
function inlineSpecSummary(spec: TeamCreateInput["inline_spec"]): { readonly name?: string; readonly members?: number } {
  const parsed = typeof spec === "string" ? parseJsonObject(spec) : spec
  if (parsed === undefined) return {}
  const name = typeof parsed.name === "string" ? parsed.name : undefined
  const members = Array.isArray(parsed.members) ? parsed.members.length : parsed.members === undefined ? undefined : 1
  return { ...(name === undefined ? {} : { name }), ...(members === undefined ? {} : { members }) }
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

export function renderTeamCreateCall(args: TeamCreateInput, theme: TeamRenderTheme): RenderComponent {
  const summary = args.inline_spec === undefined ? {} : inlineSpecSummary(args.inline_spec)
  const line = joinRendererTokens([
    "team create",
    token("name", summary.name),
    summary.members === undefined ? undefined : `members:${summary.members}`,
    args.inline_spec === undefined || summary.name === undefined ? token("spec", args.team_name) : undefined,
  ])
  return callComponent(line, theme)
}

export function renderTeamDeleteCall(args: TeamDeleteInput, theme: TeamRenderTheme): RenderComponent {
  return callComponent(joinRendererTokens(["team delete", token("run", args.team_run_id), args.force === true && "force"]), theme)
}

export function renderTeamTaskCall(operation: TeamTaskOperation, args: TeamTaskCallInput, theme: TeamRenderTheme): RenderComponent {
  const record: Record<string, unknown> = { ...args }
  const line = joinRendererTokens([
    `team task ${operation}`,
    excerptToken("subject", stringField(record, "subject"), SUBJECT_EXCERPT_MAX),
    token("id", stringField(record, "task_id")),
    token("status", stringField(record, "status")),
    token("owner", stringField(record, "owner")),
  ])
  return callComponent(line, theme)
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === "string" ? value : undefined
}

function memberRow(member: TeamCreateMemberView): Row {
  const target = formatTargetWithModel({
    ...(member.role.startsWith("category:") ? { category: member.role.slice("category:".length) } : {}),
    ...(member.role.startsWith("agent:") ? { agentType: member.role.slice("agent:".length) } : {}),
    ...(member.model === undefined ? {} : { resolvedModel: member.model }),
  })
  return {
    color: statusThemeColor(member.status),
    text: joinRendererTokens([
      `- ${normalizeRendererText(member.name)}`,
      `[${normalizeRendererText(member.status)}]`,
      target ?? member.role,
      token("task", member.task_id),
    ]),
  }
}

function failureRow(verb: string, kind: string, code: string | undefined, reason: string | undefined): Row {
  return {
    color: "error",
    text: joinRendererTokens([
      `team ${verb} ${kind}`,
      token("code", code),
      excerptToken("reason", reason, REASON_EXCERPT_MAX),
    ]),
  }
}

export function renderTeamCreateResult(
  result: ToolExecutionResult<TeamCreateDetails>,
  _options: ToolRenderResultOptions,
  theme: TeamRenderTheme,
): RenderComponent {
  const details = result.details
  if (details.kind === "created") {
    const title: Row = {
      color: "success",
      text: `team created '${normalizeRendererText(details.team_name)}' run:${normalizeRendererText(details.team_run_id)} members:${details.members.length}`,
    }
    return component([title, ...details.members.map(memberRow)], theme)
  }
  const code = details.kind === "invalid_arguments" ? undefined : details.code
  return component([failureRow("create", details.kind, code, details.reason)], theme)
}

export function renderTeamDeleteResult(
  result: ToolExecutionResult<TeamDeleteDetails>,
  _options: ToolRenderResultOptions,
  theme: TeamRenderTheme,
): RenderComponent {
  const details = result.details
  if (details.kind === "deleted") {
    return component(
      [{ color: "success", text: `team deleted run:${normalizeRendererText(details.team_run_id)} cancelled:${details.cancelled_task_ids.length}` }],
      theme,
    )
  }
  return component([failureRow("delete", details.kind, details.code, details.reason)], theme)
}

export function renderTeamTaskResult(
  operation: TeamTaskOperation,
  result: ToolExecutionResult<TeamTaskDetails>,
  _options: ToolRenderResultOptions,
  theme: TeamRenderTheme,
): RenderComponent {
  const details = result.details
  switch (details.kind) {
    case "list":
      return component(
        [
          { color: "success", text: `team task list count:${details.tasks.length}` },
          ...details.tasks.map((task) => ({
            color: statusThemeColor(task.status),
            text: joinRendererTokens([`- ${normalizeRendererText(task.id)}`, `[${normalizeRendererText(task.status)}]`, token("owner", task.owner)]),
          })),
        ],
        theme,
      )
    case "created":
    case "updated":
    case "task":
      return component([{ color: "success", text: taskIdentityLine(details.task) }], theme)
    case "not_found":
      return component([{ color: "error", text: joinRendererTokens([`team task ${operation} not_found`, token("id", details.task_id)]) }], theme)
    default:
      return component(
        [
          {
            color: "error",
            text: joinRendererTokens([
              `team task ${operation} ${details.kind}`,
              token("id", details.task_id),
              excerptToken("reason", details.reason, REASON_EXCERPT_MAX),
            ]),
          },
        ],
        theme,
      )
  }
}

function taskIdentityLine(task: { readonly id: string; readonly status: string; readonly owner?: string; readonly subject: string }): string {
  return joinRendererTokens([
    `team task ${normalizeRendererText(task.id)}`,
    `[${normalizeRendererText(task.status)}]`,
    token("owner", task.owner),
    excerptToken("subject", task.subject, SUBJECT_EXCERPT_MAX),
  ])
}
