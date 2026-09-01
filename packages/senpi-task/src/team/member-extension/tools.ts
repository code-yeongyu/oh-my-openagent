import { randomUUID } from "node:crypto"

import type { AgentToolResult, ToolDefinition } from "@code-yeongyu/senpi"
import type { TeamModeConfig } from "@oh-my-opencode/team-core/config"
import { sendMessage } from "@oh-my-opencode/team-core/team-mailbox"
import { Type, type Static } from "typebox"

import type { PersistedTaskEvent } from "../../store"
import { toolResult } from "../../tools/control/tool-result"
import { buildTeamMessage } from "../messaging/message"
import { TEAM_LEAD_SENTINEL } from "../normalize"

export const MemberTaskSendParams = Type.Object({
  to: Type.String({ description: "Recipient member name or lead." }),
  message: Type.String({ description: "Message body." }),
  summary: Type.Optional(Type.String({ description: "Optional short summary." })),
})

export type MemberTaskSendInput = Static<typeof MemberTaskSendParams>

export type MemberTaskSendDetails = {
  readonly kind: "team_message"
  readonly message_id: string
  readonly to: string
}

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

export class UnknownMemberRecipientError extends Error {
  readonly recipient: string

  constructor(recipient: string, members: readonly string[]) {
    const valid = [...members, TEAM_LEAD_SENTINEL].sort().join(", ")
    super(`Unknown team recipient: ${recipient}. Valid recipients: ${valid}.`)
    this.name = "UnknownMemberRecipientError"
    this.recipient = recipient
  }
}

export async function runMemberTaskSend(
  deps: MemberTaskSendDeps,
  input: MemberTaskSendInput,
): Promise<AgentToolResult<MemberTaskSendDetails>> {
  const recipients = new Set([...deps.members, TEAM_LEAD_SENTINEL])
  if (!recipients.has(input.to)) throw new UnknownMemberRecipientError(input.to, deps.members)

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

export function createMemberTaskSendTool(
  deps: MemberTaskSendDeps,
): ToolDefinition<typeof MemberTaskSendParams, MemberTaskSendDetails> {
  // Returned as a plain literal: senpi's defineTool is an identity helper for type inference
  // (pinned by the senpi API tripwire), so wrapping here would only statically bind this module
  // to the engine barrel.
  return {
    name: "task_send",
    label: "Task Send",
    description: "Send a durable message to another team member or the team lead.",
    parameters: MemberTaskSendParams,
    execute: (_toolCallId, params) => runMemberTaskSend(deps, params),
  }
}
