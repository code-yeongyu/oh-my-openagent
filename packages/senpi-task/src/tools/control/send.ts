import type { defineTool, ToolDefinition } from "@code-yeongyu/senpi"
import type { TSchema } from "typebox"

import { runTeamSend } from "../team/messaging"
import type { TeamToolsService } from "../team/types"
import { defaultResolveCallerSessionId } from "./caller-session"
import { renderMemberScopedTaskSendCall, renderTaskSendCall, renderTaskSendResult } from "./renderers"
import { invalidArguments, mapSendOutcome, notFound } from "./send-results"
import { isStructuredMessage, MemberScopedTaskSendParams, TaskSendParams } from "./send-schema"
import type { MemberScopedTaskSendInput, TaskSendInput } from "./send-schema"
import { resolveSendTeamRunId, routeStructuredMessage } from "./send-shutdown"
import type { TaskSendTeamRouting } from "./send-shutdown"
export type { DefaultTeamRunIdResolution } from "./send-shutdown"
import { toolResult } from "./tool-result"
import type { CallerSessionResolver, SendManager, SendResultDetails, SendToolResult } from "./types"
export { MemberScopedTaskSendParams, TaskSendParams } from "./send-schema"
export type { MemberScopedTaskSendInput, TaskSendInput } from "./send-schema"
export type { TaskSendTeamRouting } from "./send-shutdown"

const DESCRIPTION = [
  "Send a message to a child task or team member, keyed by to.",
  "Plain-text messages always steer a running child immediately.",
  "A plain-text message to a finished resident child revives that same session; disposed, evicted, cancelled, and terminal-errored children are not revived.",
  "message is required and accepts a plain string or a structured shutdown object {type:'shutdown_request'} or {type:'shutdown_response', approve, reason?}; structured messages are lead-only and need team_run_id (defaults to your single owned team).",
  "To retire a member: send {type:'shutdown_request'}, then after it wraps up {type:'shutdown_response', approve:true}.",
  "Addressing: a child task id/name goes to the live session; a team member name goes to the durable mailbox; '*' broadcasts to every member (lead-only). Plain-text bodies are capped by the team payload limit (default 32 KB); split larger payloads or send a file path.",
  "Cross-session: a child owned by another session is refused unless you pass all_scope=true.",
  "Team messages always steer into the recipient's running turn.",
  "One-shot agents (momus) always refuse task_send in every state; spawn a new momus instead.",
].join(" ")

const MEMBER_SCOPED_DESCRIPTION = [
  "Send a durable message to another team member or the team lead.",
  "Team messages always steer into the recipient's running turn.",
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

  if (typeof params.message === "string") {
    const outcome = await manager.sendToTask({
      idOrName: params.to,
      message: params.message,
      deliverAs: "steer",
      ...(callerSessionId !== undefined ? { callerSessionId } : {}),
      ...(params.all_scope === true ? { allScope: true } : {}),
    })

    if (outcome.kind !== "not_found") return mapSendOutcome(outcome)
    if (teamRouting === undefined) return notFound(manager, outcome.reason, callerSessionId)

    const resolution = await resolveSendTeamRunId(params, teamRouting)
    if (resolution.kind === "none") return notFound(manager, outcome.reason, callerSessionId)
    if (resolution.kind === "error") return invalidArguments(resolution.reason)

    const teamResult = await runTeamSend(teamRouting.service, resolution.teamRunId, teamRouting.from, {
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
  if (message === undefined) return invalidArguments("message is required")
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

// senpi declares AnyToolDefinition privately, so mirror defineTool's declared return type instead
// of hand-rolling `ToolDefinition<any, any, any>`: a senpi bump that widens or narrows that
// intersection propagates here rather than silently drifting from the engine's own shape. The
// import is type-only, so it is erased and never binds this module to the engine barrel.
type DefinedTool<TParams extends TSchema, TDetails> = ReturnType<typeof defineTool<TParams, TDetails>>

export function createMemberScopedTaskSendTool(
  deps: MemberScopedTaskSendDeps,
): DefinedTool<typeof MemberScopedTaskSendParams, SendResultDetails> {
  const resolveCaller = deps.resolveCallerSessionId ?? defaultResolveCallerSessionId
  // Returned as a plain literal: senpi's defineTool is an identity helper for type inference
  // (pinned by the senpi API tripwire), so wrapping here would only statically bind this module
  // to the engine barrel. The cast below is type-level only — defineTool was identity at runtime.
  const tool: ToolDefinition<typeof MemberScopedTaskSendParams, SendResultDetails> = {
    name: "task_send",
    label: "Task Send",
    description: MEMBER_SCOPED_DESCRIPTION,
    parameters: MemberScopedTaskSendParams,
    execute: (_toolCallId, params: MemberScopedTaskSendInput, _signal, _onUpdate, ctx) =>
      runTaskSend(deps.manager, params, resolveCaller(ctx), {
        service: deps.service,
        from: deps.from,
        teamRunId: deps.teamRunId,
      }),
    renderCall: (args, theme) => renderMemberScopedTaskSendCall(args, theme),
    renderResult: (result, options, theme) => renderTaskSendResult(result, options, theme),
  }
  return tool as DefinedTool<typeof MemberScopedTaskSendParams, SendResultDetails>
}
