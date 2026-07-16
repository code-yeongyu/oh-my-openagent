import type { AgentToolResult, ToolDefinition } from "@code-yeongyu/senpi"
import type { Message } from "@oh-my-opencode/team-core/types"
import { Type, type Static } from "typebox"

import type { WaitRegistration } from "../../team/messaging/wait-registry"
import { clampWaitTimeout, toolResult } from "../control"
import type { LeadTeamToolDeps } from "./types"

export const TeamWaitParams = Type.Object({
  from: Type.Optional(Type.String({ description: "Only receive from this member." })),
  timeout_ms: Type.Optional(Type.Number({ description: "Bounded wait timeout in milliseconds." })),
  team_run_id: Type.Optional(Type.String({ description: "Team run id when this session leads more than one team." })),
})

export type TeamWaitInput = Static<typeof TeamWaitParams>

export type TeamWaitDetails =
  | { readonly kind: "message"; readonly message_id: string; readonly from: string; readonly body: string }
  | { readonly kind: "timeout"; readonly timeout_ms: number }
  | { readonly kind: "invalid_arguments"; readonly reason: string }
  | { readonly kind: "unavailable"; readonly team_run_id: string }

export class TeamWaitAbortedError extends Error {
  constructor() {
    super("team_wait aborted")
    this.name = "TeamWaitAbortedError"
  }
}

export async function runTeamWait(
  deps: LeadTeamToolDeps,
  input: TeamWaitInput,
  signal: AbortSignal | undefined,
): Promise<AgentToolResult<TeamWaitDetails>> {
  const resolved = await deps.resolveTeamRunId(input.team_run_id)
  if (!resolved.ok) {
    return toolResult(resolved.reason, { kind: "invalid_arguments", reason: resolved.reason })
  }

  const poller = deps.resolveLeadPoller(resolved.teamRunId)
  if (poller === undefined) {
    return toolResult(`No lead poller is active for team ${resolved.teamRunId}.`, {
      kind: "unavailable",
      team_run_id: resolved.teamRunId,
    })
  }

  const timeoutMs = clampWaitTimeout(input.timeout_ms, deps.waitBounds)
  const filter = input.from === undefined ? {} : { from: input.from }
  const registration = deps.registry.register(resolved.teamRunId, filter)
  try {
    await poller.pollOnce(filter)
    const outcome = await waitForMessage(registration, timeoutMs, signal)
    switch (outcome.kind) {
      case "timeout":
        return toolResult(
          `No team message arrived within ${timeoutMs}ms. Check task_output for a committed team_message_waited recovery event.`,
          { kind: "timeout", timeout_ms: timeoutMs },
        )
      case "message":
        return toolResult(`Message from ${outcome.message.from}.`, {
          kind: "message",
          message_id: outcome.message.messageId,
          from: outcome.message.from,
          body: outcome.message.body,
        })
      default:
        return assertNever(outcome)
    }
  } finally {
    registration.cancel()
  }
}

export function createTeamWaitTool(
  deps: LeadTeamToolDeps,
): ToolDefinition {
  return {
    name: "team_wait",
    label: "Team Wait",
    description: "Wait for the next durable message to the current team lead, optionally filtered by sender.",
    parameters: TeamWaitParams,
    execute: (_toolCallId: string, params: TeamWaitInput, signal: AbortSignal | undefined) => runTeamWait(deps, params, signal),
  }
}

type WaitOutcome =
  | { readonly kind: "message"; readonly message: Message }
  | { readonly kind: "timeout" }

async function waitForMessage(
  registration: WaitRegistration<Message>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<WaitOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let abortListener: (() => void) | undefined
  const timeout = new Promise<WaitOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs)
  })
  const abort = new Promise<never>((_resolve, reject) => {
    if (signal === undefined) return
    abortListener = () => reject(signal.reason ?? new TeamWaitAbortedError())
    if (signal.aborted) abortListener()
    else signal.addEventListener("abort", abortListener, { once: true })
  })

  try {
    return await Promise.race([
      registration.promise.then((message): WaitOutcome => ({ kind: "message", message })),
      timeout,
      abort,
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (signal !== undefined && abortListener !== undefined) signal.removeEventListener("abort", abortListener)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected team_wait outcome: ${JSON.stringify(value)}`)
}
