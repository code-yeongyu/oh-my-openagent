import type { ToolDefinition } from "@code-yeongyu/senpi"
import { Type } from "typebox"
import type { Static } from "typebox"

import type { TaskStatus } from "../../state"
import { withDroppedSteeringNotice } from "../../state/queued-steering"
import { renderTaskCancelCall, renderTaskCancelResult } from "./renderers"
import { toolResult } from "./tool-result"
import type { CancelManager, CancelResultDetails, CancelToolResult } from "./types"

export const TaskCancelParams = Type.Object({
  task_id: Type.Optional(Type.String({ description: "Task id (st_...) of the child to cancel. Provide exactly one of task_id or name." })),
  name: Type.Optional(Type.String({ description: "Canonical task name; required if task_id is omitted." })),
  reason: Type.Optional(Type.String({ description: "Optional human-readable reason recorded on the cancelled task." })),
})

export type TaskCancelInput = Static<typeof TaskCancelParams>

const DESCRIPTION = [
  "Cancel a running child task and release its resources; the cancelled status is preserved so task_output can still report the outcome.",
  "Cancel is terminal and NOT resumable; cancelling a child that is not running is a no-op that reports its unchanged status.",
  "Use this to end work you no longer need.",
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
      return toolResult(withDroppedSteeringNotice(`Cancelled ${outcome.task_id} (was ${outcome.previous_status}, now ${status}).`, outcome.undelivered_messages ?? 0), {
        kind: "cancelled",
        task_id: outcome.task_id,
        previous_status: outcome.previous_status,
        status,
        ...(outcome.undelivered_messages === undefined ? {} : { undelivered_messages: outcome.undelivered_messages }),
      })
    }
    case "cancel_pending":
      return toolResult(
        withDroppedSteeringNotice(`Cancel requested for ${outcome.task_id}, but the child is unreachable: its connection to the task host dropped. It is stopped on its host before it runs anything else once reachable, or ends when the connection does not come back; its lane is released then. task_output shows the pending cancel.`, outcome.undelivered_messages ?? 0),
        { kind: "cancel_pending", task_id: outcome.task_id, previous_status: outcome.previous_status, reason: outcome.reason,
          ...(outcome.undelivered_messages === undefined ? {} : { undelivered_messages: outcome.undelivered_messages }) },
      )
    case "noop":
      return toolResult(`${outcome.reason} No change.`, {
        kind: "noop",
        task_id: outcome.task_id,
        status: outcome.status,
        reason: outcome.reason,
      })
    case "released":
      return toolResult(
        withDroppedSteeringNotice(`Task ${outcome.task_id} had already finished (${outcome.status}); its retained child or queued continuation is now released. The result stays readable with task_output, and task_send revives it.`, outcome.undelivered_messages ?? 0),
        { kind: "released", task_id: outcome.task_id, status: outcome.status,
          ...(outcome.undelivered_messages === undefined ? {} : { undelivered_messages: outcome.undelivered_messages }) },
      )
    case "stale":
      // task_cancel never names a run, so only a handle-fenced caller reaches this; keep the tool's result shapes.
      return toolResult(`${outcome.reason} No change.`, { kind: "noop", task_id: outcome.task_id, status: outcome.status, reason: outcome.reason })
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
