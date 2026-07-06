import type { ToolDefinition } from "@code-yeongyu/senpi"
import { Type } from "typebox"
import type { Static } from "typebox"

import type { ListScope, ListedTask } from "../../manager"
import { defaultResolveCallerSessionId, isTerminalStatus, toolResult } from "../control"
import { buildTaskListRows } from "./rows"
import type { ListManager, TaskListDeps, TaskListDetails, TaskListToolResult } from "./types"

export const TaskListParams = Type.Object({
  all_scope: Type.Optional(
    Type.Boolean({ description: "List every persisted task across all sessions. Off by default (only the current session's children)." }),
  ),
  include_terminal: Type.Optional(
    Type.Boolean({ description: "Include finished tasks (completed/error/cancelled/interrupted/lost). Defaults to true." }),
  ),
})

export type TaskListInput = Static<typeof TaskListParams>

const DESCRIPTION = [
  "List the child tasks of the current session as a table: task_id, name, agent/category, status, mode, model, age, pid, queue position, and an unread-result flag.",
  "Rows are sorted running first, then pending, then finished, most-recently-updated first.",
  "Pass all_scope=true to see every persisted task across all sessions; pass include_terminal=false to hide finished tasks.",
].join(" ")

export function runTaskList(
  manager: ListManager,
  params: TaskListInput,
  callerSessionId: string | undefined,
  now: () => number,
): TaskListToolResult {
  const allScope = params.all_scope === true
  const includeTerminal = params.include_terminal !== false
  const listed = collect(manager, allScope, callerSessionId)
  const filtered = includeTerminal ? listed : listed.filter((entry) => !isTerminalStatus(entry.record.status))
  const tasks = buildTaskListRows(filtered, now())
  const details: TaskListDetails = { scope: allScope ? "all" : "parent-session", include_terminal: includeTerminal, tasks }
  return toolResult(summarize(details), details)
}

// Fail-closed: without all_scope and without a caller session id, list NOTHING rather than leaking
// every session's tasks (W1-V seam obligation 1).
function collect(manager: ListManager, allScope: boolean, callerSessionId: string | undefined): readonly ListedTask[] {
  if (allScope) return manager.list({ scope: "all" })
  if (callerSessionId === undefined) return []
  const scope: ListScope = { scope: "parent-session", session_id: callerSessionId }
  return manager.list(scope)
}

function summarize(details: TaskListDetails): string {
  const running = details.tasks.filter((task) => task.status === "running").length
  const pending = details.tasks.filter((task) => task.status === "pending").length
  return `${details.tasks.length} task(s) [${details.scope}]: ${running} running, ${pending} pending.`
}

export function createTaskListTool(deps: TaskListDeps): ToolDefinition<typeof TaskListParams, TaskListDetails> {
  const resolveCaller = deps.resolveCallerSessionId ?? defaultResolveCallerSessionId
  const now = deps.now ?? Date.now
  return {
    name: "task_list",
    label: "Task List",
    description: DESCRIPTION,
    parameters: TaskListParams,
    execute: (_toolCallId, params, _signal, _onUpdate, ctx) => Promise.resolve(runTaskList(deps.manager, params, resolveCaller(ctx), now)),
  }
}
