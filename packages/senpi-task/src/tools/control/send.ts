import type { defineTool, ToolDefinition } from "@code-yeongyu/senpi"
import { log } from "@oh-my-opencode/utils"
import type { TSchema } from "typebox"

import { settledWithin } from "../../manager/settled-within"
import { runTeamSend } from "../team/messaging"
import type { TeamToolsService } from "../team/types"
import { defaultResolveCallerSessionId } from "./caller-session"
import { renderMemberScopedTaskSendCall, renderTaskSendCall, renderTaskSendResult } from "./renderers"
import { invalidArguments, mapRedispatchOutcome, mapSendOutcome, notFound } from "./send-results"
import { isStructuredMessage, MemberScopedTaskSendParams, TaskSendParams } from "./send-schema"
import type { MemberScopedTaskSendInput, TaskSendInput } from "./send-schema"
import { resolveSendTeamRunId, routeStructuredMessage } from "./send-shutdown"
import type { TaskSendTeamRouting } from "./send-shutdown"
export type { DefaultTeamRunIdResolution } from "./send-shutdown"
import { toolErrorResult, toolResult } from "./tool-result"
import type { CallerSessionResolver, SendManager, SendResultDetails, SendToolResult } from "./types"
export { MemberScopedTaskSendParams, TaskSendParams } from "./send-schema"
export type { MemberScopedTaskSendInput, TaskSendInput } from "./send-schema"
export type { TaskSendTeamRouting } from "./send-shutdown"

const DESCRIPTION = [
  "Send a message to a child task or team member, keyed by to.",
  "Plain-text messages always steer a running child immediately.",
  "A plain-text message to a parked in-process or detached RPC child with a transcript and recorded launch spec resumes that session after eligible finished runs. Killed, cancelled, and lost children never revive; unfinished parked children automatically resume or end within the recovery budget.",
  "redispatch:true (no message) re-dispatches a task flagged 'resumed, waiting for input' onto a fresh live session, replaying its persisted prompt; the old dead session is abandoned.",
  "message is required and accepts a plain string or a structured shutdown object {type:'shutdown_request'} or {type:'shutdown_response', approve, reason?}; structured messages are lead-only and need team_run_id (defaults to your single owned team).",
  "To retire a member: send {type:'shutdown_request'}, then after it wraps up {type:'shutdown_response', approve:true}.",
  "Addressing: a child task id/name goes to the live session; a team member name goes to the durable mailbox; '*' broadcasts to every member (lead-only). Plain-text bodies are capped by the team payload limit (default 32 KB); split larger payloads or send a file path.",
  "Cross-session: a child owned by another session is refused unless you pass all_scope=true.",
  "Team messages always steer into the recipient's running turn.",
  "One-shot agents (plan-reviewer) always refuse task_send in every state; spawn a new plan-reviewer instead.",
].join(" ")

const MEMBER_SCOPED_DESCRIPTION = [
  "Send a durable message to another team member or the team lead.",
  "Team messages always steer into the recipient's running turn.",
].join(" ")

export type LateSendDelivery = {
  readonly cause: "host_slow" | "aborted"
  readonly callerSessionId: string | undefined
}

export type LateSendOutcome = (result: SendToolResult, delivery: LateSendDelivery) => void

export type TaskSendDeps = {
  readonly manager: SendManager
  readonly teamRouting?: TaskSendTeamRouting
  readonly resolveCallerSessionId?: CallerSessionResolver
  readonly deliverLateOutcome?: LateSendOutcome
}

export type TaskSendRunOptions = {
  readonly signal?: AbortSignal
  readonly deliverLateOutcome?: LateSendOutcome
}

// A steer to a live child is acknowledged well inside this window; a revive that has to wait on a busy
// task host is not, and must not hold the caller's turn for the host's admission budget (#10042). The
// window applies only where a late outcome has somewhere to go; every caller can still abort the wait.
const SEND_REPORT_WINDOW_MS = 1_000

export async function runTaskSend(
  manager: SendManager,
  params: TaskSendInput,
  callerSessionId: string | undefined,
  teamRouting?: TaskSendTeamRouting,
  options: TaskSendRunOptions = {},
): Promise<SendToolResult> {
  if (options.signal?.aborted === true) {
    return toolResult(`Not sent to ${params.to}: the turn was aborted before the message went out.`, { kind: "aborted", to: params.to })
  }
  const deliver = options.deliverLateOutcome
  const sending = sendNow(manager, params, callerSessionId, teamRouting)
  const reported = await settledWithin(sending, deliver === undefined ? Number.POSITIVE_INFINITY : SEND_REPORT_WINDOW_MS, options.signal)
  if (reported.settled) return reported.value
  const cause = reported.cause === "aborted" ? "aborted" : "host_slow"
  sending.then(
    (result) => {
      if (deliver !== undefined) deliver(result, { cause, callerSessionId })
      else log("senpi-task task_send outcome after the caller stopped waiting", { to: params.to, details: result.details })
    },
    (error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error)
      log("senpi-task task_send failed after the caller stopped waiting", { to: params.to, reason })
      deliver?.(toolErrorResult(`task_send to ${params.to} failed: ${reason}`, { kind: "send_failed", to: params.to, reason }), { cause, callerSessionId })
    },
  )
  const lead = cause === "aborted" ? "The turn was aborted while the message was being delivered" : "The task host is slow to answer"
  const follow = deliver === undefined ? "check task_output for the result" : "the outcome arrives as a notification"
  return toolResult(`${lead}; delivery to ${params.to} continues in the background and ${follow}. Do not resend it.`, {
    kind: "delivering", to: params.to, reason: cause,
  })
}

async function sendNow(
  manager: SendManager,
  params: TaskSendInput,
  callerSessionId: string | undefined,
  teamRouting?: TaskSendTeamRouting,
): Promise<SendToolResult> {
  const validation = validateParams(params)
  if (validation !== undefined) return validation

  if (params.redispatch === true) {
    if (manager.redispatchTask === undefined) return invalidArguments("this manager does not support redispatch")
    const scopedCaller = params.all_scope === true ? undefined : callerSessionId
    const outcome = await manager.redispatchTask(params.to, scopedCaller)
    return mapRedispatchOutcome(manager, outcome, callerSessionId)
  }

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
    const wrapped: SendToolResult = toolResult(firstText(teamResult), { kind: "team_message", team: teamResult.details })
    return teamResult.isError === true ? { ...wrapped, isError: true } : wrapped
  }

  if (params.message !== undefined) return routeStructuredMessage(params.to, params.message, params, teamRouting)

  return invalidArguments("message is required")
}

function validateParams(params: TaskSendInput): SendToolResult | undefined {
  if (params.redispatch === true && params.message !== undefined) {
    return invalidArguments("redispatch replays the task's persisted prompt; message is forbidden with redispatch:true")
  }
  const message = params.message
  if (message === undefined && params.redispatch !== true) return invalidArguments("message is required")
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
    execute: (_toolCallId, params, signal, _onUpdate, ctx) => runTaskSend(deps.manager, params, resolveCaller(ctx), deps.teamRouting, {
      ...(signal === undefined ? {} : { signal }),
      ...(deps.deliverLateOutcome === undefined ? {} : { deliverLateOutcome: deps.deliverLateOutcome }),
    }),
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
    execute: (_toolCallId, params: MemberScopedTaskSendInput, signal, _onUpdate, ctx) =>
      runTaskSend(deps.manager, params, resolveCaller(ctx), {
        service: deps.service,
        from: deps.from,
        teamRunId: deps.teamRunId,
      }, signal === undefined ? {} : { signal }),
    renderCall: (args, theme) => renderMemberScopedTaskSendCall(args, theme),
    renderResult: (result, options, theme) => renderTaskSendResult(result, options, theme),
  }
  return tool as DefinedTool<typeof MemberScopedTaskSendParams, SendResultDetails>
}
