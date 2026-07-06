import type { ToolDefinition } from "@code-yeongyu/senpi"
import { Type } from "typebox"
import type { Static } from "typebox"

import { DEFAULT_SEND_DELIVERY } from "../../steering"
import { defaultResolveCallerSessionId } from "./caller-session"
import { toolResult } from "./tool-result"
import type { CallerSessionResolver, SendManager, SendResultDetails, SendToolResult } from "./types"

export const TaskSendParams = Type.Object({
  task_id: Type.Optional(Type.String({ description: "Task id (st_...) of the child to message." })),
  name: Type.Optional(Type.String({ description: "Canonical task name, as an alternative to task_id." })),
  message: Type.String({ description: "The instruction or context to deliver to the child." }),
  deliver_as: Type.Optional(
    Type.Union([Type.Literal("steer"), Type.Literal("followUp")], {
      description: "steer interrupts the running turn immediately; followUp (default) queues the message for the next turn.",
    }),
  ),
  all_scope: Type.Optional(
    Type.Boolean({ description: "Allow messaging a child owned by another session. Off by default." }),
  ),
})

export type TaskSendInput = Static<typeof TaskSendParams>

const DESCRIPTION = [
  "Send a message to a running or paused child task, keyed by task_id or name.",
  "Use deliver_as='steer' to redirect work mid-turn immediately; deliver_as='followUp' (default) queues the message so the child picks it up after its current turn.",
  "A message to a still-queued child buffers and drains in order when it starts; a message to a finished child revives that same session as a follow-up.",
  "Cross-session: a child owned by another session is refused unless you pass all_scope=true.",
  "This is the redirect/nudge tool. Use task_interrupt to stop a turn and keep the child, or task_cancel to end it.",
].join(" ")

export type TaskSendDeps = {
  readonly manager: SendManager
  readonly resolveCallerSessionId?: CallerSessionResolver
}

export async function runTaskSend(
  manager: SendManager,
  params: TaskSendInput,
  callerSessionId: string | undefined,
): Promise<SendToolResult> {
  const idOrName = params.task_id ?? params.name
  if (idOrName === undefined) {
    return invalidArguments("Provide task_id or name to identify the child task.")
  }

  const outcome = await manager.sendToTask({
    idOrName,
    message: params.message,
    deliverAs: params.deliver_as ?? DEFAULT_SEND_DELIVERY,
    ...(callerSessionId !== undefined ? { callerSessionId } : {}),
    ...(params.all_scope === true ? { allScope: true } : {}),
  })

  switch (outcome.kind) {
    case "steered":
      return toolResult(`Delivered to ${outcome.task_id} as ${outcome.delivered}.`, {
        kind: "steered",
        task_id: outcome.task_id,
        status: outcome.status,
        delivered: outcome.delivered,
      })
    case "revived":
      return toolResult(`Revived ${outcome.task_id} (run epoch ${outcome.run_epoch}).`, {
        kind: "revived",
        task_id: outcome.task_id,
        run_epoch: outcome.run_epoch,
      })
    case "queued":
      return toolResult(`Queued for ${outcome.task_id} at position ${outcome.queue_position}.`, {
        kind: "queued",
        task_id: outcome.task_id,
        queue_position: outcome.queue_position,
      })
    case "not_continuable":
      return toolResult(`${outcome.reason} ${outcome.suggestion}`, {
        kind: "not_continuable",
        task_id: outcome.task_id,
        reason: outcome.reason,
        suggestion: outcome.suggestion,
      })
    case "scope_denied":
      return toolResult(outcome.reason, {
        kind: "scope_denied",
        task_id: outcome.task_id,
        owning_session_id: outcome.owning_session_id,
        reason: outcome.reason,
      })
    case "not_found":
      return notFound(manager, outcome.reason, callerSessionId)
  }
}

function notFound(manager: SendManager, reason: string, callerSessionId: string | undefined): SendToolResult {
  const known = knownTaskNames(manager, callerSessionId)
  const listText = known.length > 0 ? ` Known tasks in this session: ${known.join(", ")}.` : ""
  return toolResult(`${reason}${listText}`, { kind: "not_found", reason, known_tasks: known })
}

function knownTaskNames(manager: SendManager, callerSessionId: string | undefined): readonly string[] {
  const scope = callerSessionId === undefined ? ({ scope: "all" } as const) : ({ scope: "parent-session", session_id: callerSessionId } as const)
  const names: string[] = []
  for (const listed of manager.list(scope)) {
    names.push(listed.record.name ?? listed.record.task_id)
  }
  return names
}

function invalidArguments(reason: string): SendToolResult {
  return toolResult(reason, { kind: "invalid_arguments", reason })
}

export function createTaskSendTool(deps: TaskSendDeps): ToolDefinition<typeof TaskSendParams, SendResultDetails> {
  const resolveCaller = deps.resolveCallerSessionId ?? defaultResolveCallerSessionId
  return {
    name: "task_send",
    label: "Task Send",
    description: DESCRIPTION,
    parameters: TaskSendParams,
    execute: (_toolCallId, params, _signal, _onUpdate, ctx) => runTaskSend(deps.manager, params, resolveCaller(ctx)),
  }
}
