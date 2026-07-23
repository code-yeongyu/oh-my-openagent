import { randomUUID } from "node:crypto"

import { defineTool, type AgentToolResult, type ToolDefinition } from "@code-yeongyu/senpi"
import type { TeamModeConfig } from "@oh-my-opencode/team-core/config"
import { sendMessage } from "@oh-my-opencode/team-core/team-mailbox"
import type { Message } from "@oh-my-opencode/team-core/types"
import { Type, type Static } from "typebox"

import type { PersistedTaskEvent } from "../../store"
import { clampWaitTimeout, type WaitBounds } from "../../tools/control/clamp"
import { toolResult } from "../../tools/control/tool-result"
import { formatMessageText } from "../../tools/team/wait"
import { buildTeamMessage } from "../messaging/message"
import type { WaitRegistration, WaitRegistry } from "../messaging/wait-registry"
import { TEAM_LEAD_SENTINEL } from "../normalize"
import type { MemberSelfPoller } from "./self-poller"

export const MemberTaskSendParams = Type.Object({
  to: Type.String({ description: "Recipient member name or lead." }),
  message: Type.String({ description: "Message body." }),
  summary: Type.Optional(Type.String({ description: "Optional short summary." })),
})

export const MemberTeamWaitParams = Type.Object({
  from: Type.Optional(Type.String({ description: "Only receive from this member or lead." })),
  timeout_ms: Type.Optional(Type.Number({ description: "Bounded wait timeout in milliseconds." })),
})

export type MemberTaskSendInput = Static<typeof MemberTaskSendParams>
export type MemberTeamWaitInput = Static<typeof MemberTeamWaitParams>

export type MemberTaskSendDetails = {
  readonly kind: "team_message"
  readonly message_id: string
  readonly to: string
}

export type MemberTeamWaitDetails =
  | { readonly kind: "message"; readonly message_id: string; readonly from: string; readonly body: string }
  | { readonly kind: "timeout"; readonly timeout_ms: number }

export type MemberTaskSendDeps = {
  readonly teamRunId: string
  readonly memberName: string
  readonly taskId: string
  readonly config: TeamModeConfig
  readonly members: readonly string[]
  readonly appendEvent?: (taskId: string, event: PersistedTaskEvent) => void
  readonly now?: () => number
  readonly newMessageId?: () => string
}

export type MemberTeamWaitDeps = {
  readonly poller: Pick<MemberSelfPoller, "pollOnce">
  readonly waitRegistry: WaitRegistry<Message>
  readonly waitBounds: WaitBounds
}

export class UnknownMemberRecipientError extends Error {
  readonly recipient: string

  constructor(recipient: string) {
    super(`Unknown team recipient: ${recipient}`)
    this.name = "UnknownMemberRecipientError"
    this.recipient = recipient
  }
}

export class MemberTeamWaitAbortedError extends Error {
  constructor() {
    super("team_wait aborted")
    this.name = "MemberTeamWaitAbortedError"
  }
}

export async function runMemberTaskSend(
  deps: MemberTaskSendDeps,
  input: MemberTaskSendInput,
): Promise<AgentToolResult<MemberTaskSendDetails>> {
  const recipients = new Set([...deps.members, TEAM_LEAD_SENTINEL])
  if (!recipients.has(input.to)) throw new UnknownMemberRecipientError(input.to)

  const message = buildTeamMessage({
    from: deps.memberName,
    to: input.to,
    body: input.message,
    ...(input.summary !== undefined ? { summary: input.summary } : {}),
  }, {
    now: deps.now ?? Date.now,
    newMessageId: deps.newMessageId ?? randomUUID,
  })

  await sendMessage(message, deps.teamRunId, deps.config, {
    isLead: false,
    activeMembers: [...deps.members],
    leadRecipient: TEAM_LEAD_SENTINEL,
  })
  deps.appendEvent?.(deps.taskId, {
    type: "team_message_sent",
    payload: { message_id: message.messageId, from: message.from, to: message.to, kind: message.kind },
  })
  return toolResult(`Message enqueued to ${input.to} (id: ${message.messageId}).`, {
    kind: "team_message",
    message_id: message.messageId,
    to: input.to,
  })
}

export async function runMemberTeamWait(
  deps: MemberTeamWaitDeps,
  input: MemberTeamWaitInput,
  signal: AbortSignal | undefined,
): Promise<AgentToolResult<MemberTeamWaitDetails>> {
  const timeoutMs = clampWaitTimeout(input.timeout_ms, deps.waitBounds)
  const registration = deps.waitRegistry.register(input.from === undefined ? {} : { from: input.from })

  try {
    await deps.poller.pollOnce(input.from === undefined ? {} : { from: input.from })
    const outcome = await waitForMessage(registration, timeoutMs, signal)
    switch (outcome.kind) {
      case "timeout":
        return toolResult(
          `No team message arrived within ${timeoutMs}ms. Check task_output for a committed team_message_waited recovery event.`,
          { kind: "timeout", timeout_ms: timeoutMs },
        )
      case "message":
        return toolResult(formatMessageText(outcome.message), {
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

export function createMemberTaskSendTool(
  deps: MemberTaskSendDeps,
): ToolDefinition<typeof MemberTaskSendParams, MemberTaskSendDetails> {
  return defineTool({
    name: "task_send",
    label: "Task Send",
    description: "Send a durable message to another team member or the team lead.",
    parameters: MemberTaskSendParams,
    execute: (_toolCallId, params) => runMemberTaskSend(deps, params),
  })
}

export function createMemberTeamWaitTool(
  deps: MemberTeamWaitDeps,
): ToolDefinition<typeof MemberTeamWaitParams, MemberTeamWaitDetails> {
  return defineTool({
    name: "team_wait",
    label: "Team Wait",
    description: "Wait for the next durable team message, optionally filtered by sender.",
    parameters: MemberTeamWaitParams,
    execute: (_toolCallId, params, signal) => runMemberTeamWait(deps, params, signal),
  })
}

type WaitOutcome =
  | { readonly kind: "message"; readonly message: Message }
  | { readonly kind: "timeout" }

function assertNever(value: never): never {
  throw new TypeError(`Unexpected team_wait outcome: ${JSON.stringify(value)}`)
}

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
    abortListener = () => reject(signal.reason ?? new MemberTeamWaitAbortedError())
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
