import type { ToolDefinition } from "@code-yeongyu/senpi"
import { Type } from "typebox"
import type { Static } from "typebox"

import { toolResult } from "./tool-result"
import type { InterruptManager, InterruptResultDetails, InterruptToolResult } from "./types"

export const TaskInterruptParams = Type.Object({
  task_id: Type.Optional(Type.String({ description: "Task id (st_...) of the child to interrupt." })),
  name: Type.Optional(Type.String({ description: "Canonical task name, as an alternative to task_id." })),
})

export type TaskInterruptInput = Static<typeof TaskInterruptParams>

const DESCRIPTION = [
  "Interrupt a running child task: stop its current turn now while keeping the child available for later task_send or task_output.",
  "Returns previous_status, the status observed before the interrupt was handled.",
  "Interrupting a child that is not running is a no-op that reports its unchanged status.",
  "Use this to halt work you no longer need mid-turn; use task_cancel to end the child entirely, or task_send to redirect it.",
].join(" ")

export type TaskInterruptDeps = {
  readonly manager: InterruptManager
}

export async function runTaskInterrupt(manager: InterruptManager, params: TaskInterruptInput): Promise<InterruptToolResult> {
  const idOrName = params.task_id ?? params.name
  if (idOrName === undefined) {
    return toolResult("Provide task_id or name to identify the child task.", {
      kind: "invalid_arguments",
      reason: "Provide task_id or name to identify the child task.",
    })
  }

  const outcome = await manager.interruptTask(idOrName)
  switch (outcome.kind) {
    case "interrupted":
      return toolResult(`Interrupted ${outcome.task_id} (was ${outcome.previous_status}).`, {
        kind: "interrupted",
        task_id: outcome.task_id,
        previous_status: outcome.previous_status,
      })
    case "noop":
      return toolResult(`${outcome.reason} No change.`, {
        kind: "noop",
        task_id: outcome.task_id,
        previous_status: outcome.status,
        reason: outcome.reason,
      })
    case "not_found":
      return toolResult(outcome.reason, { kind: "not_found", reason: outcome.reason })
  }
}

export function createTaskInterruptTool(deps: TaskInterruptDeps): ToolDefinition<typeof TaskInterruptParams, InterruptResultDetails> {
  return {
    name: "task_interrupt",
    label: "Task Interrupt",
    description: DESCRIPTION,
    parameters: TaskInterruptParams,
    execute: (_toolCallId, params) => runTaskInterrupt(deps.manager, params),
  }
}
