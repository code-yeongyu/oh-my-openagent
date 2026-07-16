import { defineTool, type ToolDefinition } from "@code-yeongyu/senpi"

import { DEFAULT_SEND_DELIVERY } from "../../steering"
import { runTeamSend } from "../team/messaging"
import type { TeamToolsService } from "../team/types"
import { defaultResolveCallerSessionId } from "./caller-session"
import { renderTaskSendCall, renderTaskSendResult } from "./renderers"
import { invalidArguments, mapSendOutcome, notFound, scopeDenied } from "./send-results"
import { isStructuredMessage, TaskSendParams } from "./send-schema"
import type { TaskSendInput } from "./send-schema"
import { missingTeamRunId, resolveTeamRunId, routeStructuredMessage } from "./send-shutdown"
import type { TaskSendTeamRouting } from "./send-shutdown"
import { toolResult } from "./tool-result"
import type { CallerSessionResolver, SendManager, SendResultDetails, SendToolResult } from "./types"
export { TaskSendParams } from "./send-schema"
export type { TaskSendInput } from "./send-schema"
export type { TaskSendTeamRouting } from "./send-shutdown"

const DESCRIPTION = [
  "Send a message to a child task or team member, keyed by to.",
  "Use deliver_as='steer' to redirect a running child immediately; deliver_as='followUp' (default) queues a plain-text follow-up.",
  "Use deliver_as='interrupt' without a message to park a running child as interrupted while keeping its resident session.",
  "A plain-text message to a finished resident child revives that same session as a follow-up; disposed, evicted, or cancelled children are not revived.",
  "Structured shutdown messages are lead-only and route to the team shutdown protocol.",
  "Cross-session: a child owned by another session is refused unless you pass all_scope=true.",
].join(" ")

export type TaskSendDeps = {
  readonly manager: SendManager
  readonly teamRouting?: TaskSendTeamRouting
  readonly resolveCallerSessionId?: CallerSessionResolver
}

export async function runTaskSend(
  manager: SendManager,
  params: TaskSendInput,
  callerSessionId: string | undefined,
  teamRouting?: TaskSendTeamRouting,
): Promise<SendToolResult> {
  const validation = validateParams(params)
  if (validation !== undefined) return validation

  if (params.deliver_as === "interrupt") {
    const denied = scopeDenied(manager, params.to, callerSessionId, params.all_scope)
    if (denied !== undefined) return denied
    const outcome = await manager.interruptTask(params.to)
    switch (outcome.kind) {
      case "interrupted":
        return toolResult(`Interrupted ${outcome.task_id}.`, {
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
        return notFound(manager, outcome.reason, callerSessionId)
    }
  }

  if (typeof params.message === "string") {
    const outcome = await manager.sendToTask({
      idOrName: params.to,
      message: params.message,
      deliverAs: params.deliver_as ?? DEFAULT_SEND_DELIVERY,
      ...(callerSessionId !== undefined ? { callerSessionId } : {}),
      ...(params.all_scope === true ? { allScope: true } : {}),
    })

    if (outcome.kind !== "not_found") return mapSendOutcome(outcome)
    if (teamRouting === undefined) return notFound(manager, outcome.reason, callerSessionId)

    const runId = resolveTeamRunId(params, teamRouting)
    if (runId === undefined) return missingTeamRunId()

    const teamResult = await runTeamSend(teamRouting.service, runId, teamRouting.from, {
      to: params.to,
      body: params.message,
      ...(params.summary !== undefined ? { summary: params.summary } : {}),
    })
    return toolResult(firstText(teamResult), { kind: "team_message", team: teamResult.details })
  }

  if (params.message !== undefined) return routeStructuredMessage(params.to, params.message, params, teamRouting)

  return invalidArguments("message is required")
}

function validateParams(params: TaskSendInput): SendToolResult | undefined {
  const message = params.message
  if (isStructuredMessage(message) && params.deliver_as !== undefined) {
    return invalidArguments("deliver_as applies only to plain-text messages")
  }
  if (params.deliver_as === "interrupt" && typeof message === "string") {
    return invalidArguments("interrupt is a pure park and takes no message; send the follow-up in a second task_send (a message to an interrupted resident child revives it)")
  }
  if (message === undefined && params.deliver_as !== "interrupt") {
    return invalidArguments("message is required")
  }
  if (isShutdownRejectWithoutReason(message)) {
    return invalidArguments("reason is required when rejecting a shutdown")
  }
  return undefined
}

function isShutdownRejectWithoutReason(message: TaskSendInput["message"]): boolean {
  return (
    isStructuredMessage(message) &&
    message.type === "shutdown_response" &&
    message.approve === false &&
    (message.reason === undefined || message.reason.trim().length === 0)
  )
}

function firstText(result: Awaited<ReturnType<typeof runTeamSend>>): string {
  const first = result.content[0]
  return first?.type === "text" ? first.text : "Team message sent."
}

export function createTaskSendTool(deps: TaskSendDeps): ToolDefinition<typeof TaskSendParams, SendResultDetails> {
  const resolveCaller = deps.resolveCallerSessionId ?? defaultResolveCallerSessionId
  return {
    name: "task_send",
    label: "Task Send",
    description: DESCRIPTION,
    parameters: TaskSendParams,
    execute: (_toolCallId, params, _signal, _onUpdate, ctx) => runTaskSend(deps.manager, params, resolveCaller(ctx), deps.teamRouting),
    renderCall: (args, theme) => renderTaskSendCall(args, theme),
    renderResult: (result, options, theme) => renderTaskSendResult(result, options, theme),
  }
}

export type MemberScopedTaskSendDeps = {
  readonly manager: SendManager
  readonly service: TeamToolsService
  readonly teamRunId: string
  readonly from: string
  readonly resolveCallerSessionId?: CallerSessionResolver
}

export function createMemberScopedTaskSendTool(deps: MemberScopedTaskSendDeps) {
  const resolveCaller = deps.resolveCallerSessionId ?? defaultResolveCallerSessionId
  return defineTool<typeof TaskSendParams, SendResultDetails>({
    name: "task_send",
    label: "Task Send",
    description: DESCRIPTION,
    parameters: TaskSendParams,
    execute: (_toolCallId, params, _signal, _onUpdate, ctx) =>
      runTaskSend(deps.manager, params, resolveCaller(ctx), {
        service: deps.service,
        from: deps.from,
        teamRunId: deps.teamRunId,
      }),
    renderCall: (args, theme) => renderTaskSendCall(args, theme),
    renderResult: (result, options, theme) => renderTaskSendResult(result, options, theme),
  })
}
