import type { ToolDefinition } from "@code-yeongyu/senpi"
import { Type } from "typebox"
import type { Static } from "typebox"

import type { TaskStatus } from "../../state"
import { renderTaskCancelCall, renderTaskCancelResult } from "./renderers"
import { toolResult } from "./tool-result"
import type { CancelManager, CancelResultDetails, CancelToolResult } from "./types"

export const TaskCancelParams = Type.Object({
  task_id: Type.Optional(Type.String({ description: "Task id (st_...) of the child to cancel." })),
  name: Type.Optional(Type.String({ description: "Canonical task name, as an alternative to task_id." })),
  reason: Type.Optional(Type.String({ description: "Optional human-readable reason recorded on the cancelled task." })),
})

export type TaskCancelInput = Static<typeof TaskCancelParams>

const DESCRIPTION = [
  "Cancel a running child task and release its resources; the cancelled status is preserved so task_output can still report the outcome.",
  "Cancel is terminal and NOT resumable; cancelling a child that is not running is a no-op that reports its unchanged status.",
  'Use this to end work you no longer need; to stop-but-keep the current child, use task_send(deliver_as:"interrupt").',
].join(" ")

export type TaskCancelDeps = {
  readonly manager: CancelManager
}

export async function runTaskCancel(manager: CancelManager, params: TaskCancelInput): Promise<CancelToolResult> {
  const idOrName = params.task_id ?? params.name
  if (idOrName === undefined) {
    return toolResult("Provide task_id or name to identify the child task.", {
      kind: "invalid_arguments",
      reason: "Provide task_id or name to identify the child task.",
    })
  }

  const outcome = await manager.cancelTask(idOrName, params.reason)
  switch (outcome.kind) {
    case "cancelled": {
      const status = manager.get(outcome.task_id)?.status ?? ("cancelled" satisfies TaskStatus)
      return toolResult(`Cancelled ${outcome.task_id} (was ${outcome.previous_status}, now ${status}).`, {
        kind: "cancelled",
        task_id: outcome.task_id,
        previous_status: outcome.previous_status,
        status,
      })
    }
    case "noop":
      return toolResult(`${outcome.reason} No change.`, {
        kind: "noop",
        task_id: outcome.task_id,
        status: outcome.status,
        reason: outcome.reason,
      })
    case "not_found":
      return toolResult(outcome.reason, { kind: "not_found", reason: outcome.reason })
  }
}

export function createTaskCancelTool(deps: TaskCancelDeps): ToolDefinition<typeof TaskCancelParams, CancelResultDetails> {
  return {
    name: "task_cancel",
    label: "Task Cancel",
    description: DESCRIPTION,
    parameters: TaskCancelParams,
    execute: (_toolCallId, params) => runTaskCancel(deps.manager, params),
    renderCall: (args, theme) => renderTaskCancelCall(args, theme),
    renderResult: (result, options, theme) => renderTaskCancelResult(result, options, theme),
  }
}
