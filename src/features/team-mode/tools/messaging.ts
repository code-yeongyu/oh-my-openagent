import { randomUUID } from "node:crypto"

import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { z } from "zod"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { log } from "../../../shared/logger"
import { applyMemberSessionRouting, buildMemberPromptBody } from "../member-session-routing"
import { lookupTeamSession } from "../team-session-registry"
import { loadRuntimeState } from "../team-state-store/store"
import { buildEnvelope } from "../team-mailbox/poll"
import {
  commitDeliveryReservation,
  releaseDeliveryReservation,
  reserveMessageForDelivery,
} from "../team-mailbox/reservation"
import { BroadcastNotPermittedError, sendMessage } from "../team-mailbox/send"

import type { Message } from "../types"
import { MessageSchema } from "../types"

const MESSAGE_TOOL_KINDS = ["message", "announcement"] as const

export type LiveDeliveryClient = {
  session: {
    promptAsync(input: {
      path: { id: string }
      body: {
        parts: Array<{ type: "text"; text: string }>
        agent?: string
        model?: { providerID: string; modelID: string }
        variant?: string
      }
      query?: { directory: string }
    }): Promise<unknown>
  }
}

type TeamRuntimeDetails = {
  teamRunId: string
  isLead: boolean
  senderName: string
  activeMembers: string[]
}

const TeamReferenceArgsSchema = z.object({
  path: z.string().min(1),
  description: z.string().optional(),
})

const TeamSendMessageArgsSchema = z.object({
  teamRunId: z.string().min(1),
  to: z.string().min(1),
  body: z.string(),
  kind: z.enum(MESSAGE_TOOL_KINDS).optional(),
  correlationId: z.string().uuid().optional(),
  summary: z.string().optional(),
  references: z.array(TeamReferenceArgsSchema).optional(),
})

type DeliveryReservation = Awaited<ReturnType<typeof reserveMessageForDelivery>>

async function resolveTeamRuntimeDetails(teamRunId: string, sessionID: string, config: TeamModeConfig): Promise<TeamRuntimeDetails> {
  const registryEntry = lookupTeamSession(sessionID)
  if (registryEntry?.teamRunId === teamRunId) {
    const runtimeState = await loadRuntimeState(teamRunId, config)

    return {
      teamRunId: runtimeState.teamRunId,
      isLead: registryEntry.role === "lead",
      senderName: registryEntry.memberName,
      activeMembers: runtimeState.members
        .map((entry) => entry.name)
        .filter((name) => name !== registryEntry.memberName),
    }
  }

  try {
    const runtimeState = await loadRuntimeState(teamRunId, config)
    const isLead = runtimeState.leadSessionId === sessionID
    const leadMember = isLead
      ? runtimeState.members.find((member) => member.agentType === "leader")
      : undefined
    const member = runtimeState.members.find((entry) => entry.sessionId === sessionID)
    const senderName = leadMember?.name ?? member?.name ?? "unknown"

    return {
      teamRunId: runtimeState.teamRunId,
      isLead,
      senderName,
      activeMembers: runtimeState.members
        .map((entry) => entry.name)
        .filter((name) => name !== senderName),
    }
  } catch {
    return {
      teamRunId,
      isLead: false,
      senderName: "unknown",
      activeMembers: [],
    }
  }
}

async function releaseReservationSafely(
  reservation: DeliveryReservation,
  input: { teamRunId: string; recipient: string; messageId: string },
): Promise<void> {
  if (reservation === null) return

  try {
    await releaseDeliveryReservation(reservation)
  } catch (releaseError) {
    log("[team-mailbox] failed to release delivery reservation", {
      error: releaseError instanceof Error ? releaseError.message : String(releaseError),
      teamRunId: input.teamRunId,
      recipient: input.recipient,
      messageId: input.messageId,
    })
  }
}

async function deliverLive(
  client: LiveDeliveryClient,
  message: Message,
  teamRunId: string,
  deliveredTo: readonly string[],
  config: TeamModeConfig,
  directory: string,
): Promise<void> {
  const runtimeState = await loadRuntimeState(teamRunId, config)
  const envelope = buildEnvelope(message)

  for (const recipientName of deliveredTo) {
    // Reserve the inbox file before delivering so the transform-hook fallback
    // cannot re-read the same message while promptAsync is in flight.
    const reservation = await reserveMessageForDelivery(teamRunId, recipientName, message.messageId, config)
    if (reservation === null) continue

    const recipientMember = runtimeState.members.find((entry) => entry.name === recipientName)
    if (!recipientMember) {
      await releaseReservationSafely(reservation, {
        teamRunId,
        recipient: recipientName,
        messageId: message.messageId,
      })
      continue
    }

    const recipientSessionId = recipientMember.sessionId
    if (!recipientSessionId) {
      log("[team-mailbox] live delivery unavailable, falling back to inbox injection", {
        reason: "missing-session-id",
        teamRunId,
        recipient: recipientName,
        messageId: message.messageId,
      })
      await releaseReservationSafely(reservation, {
        teamRunId,
        recipient: recipientName,
        messageId: message.messageId,
      })
      continue
    }

    applyMemberSessionRouting(recipientSessionId, recipientMember)

    try {
      await client.session.promptAsync({
        path: { id: recipientSessionId },
        body: buildMemberPromptBody(recipientMember, envelope),
        query: { directory: recipientMember.worktreePath ?? directory },
      })
      await commitDeliveryReservation(reservation)
      log("[team-mailbox] live delivery committed", {
        teamRunId,
        recipient: recipientName,
        recipientSessionId,
        messageId: message.messageId,
      })
    } catch (error) {
      log("[team-mailbox] live delivery failed, falling back to inbox injection", {
        error: error instanceof Error ? error.message : String(error),
        teamRunId,
        recipient: recipientName,
        messageId: message.messageId,
      })
      await releaseReservationSafely(reservation, {
        teamRunId,
        recipient: recipientName,
        messageId: message.messageId,
      })
    }
  }
}

export function createTeamSendMessageTool(config: TeamModeConfig, client: LiveDeliveryClient): ToolDefinition {
  return tool({
    description: "Send a message to a team member or broadcast to the team.",
    args: {
      teamRunId: tool.schema.string().describe("Team run ID"),
      to: tool.schema.string().describe("Recipient name or * for broadcast"),
      body: tool.schema.string().describe("Message body"),
      kind: tool.schema.enum(MESSAGE_TOOL_KINDS).optional().default("message").describe("Message kind"),
      correlationId: tool.schema.string().optional().describe("Optional UUID correlation ID. Do not use task IDs like 'task-1'."),
      summary: tool.schema.string().optional().describe("Optional summary"),
      references: tool.schema.array(tool.schema.object({
        path: tool.schema.string(),
        description: tool.schema.string().optional(),
      })).optional().describe("Optional references as [{ path, description? }]"),
    },
    execute: async (rawArgs, context) => {
      const args = TeamSendMessageArgsSchema.parse(rawArgs)
      const runtimeContext = context as { sessionID?: string; directory?: string }
      const sessionID = runtimeContext.sessionID

      if (!sessionID) {
        throw new Error("session ID is required")
      }

      const targetDirectory = typeof runtimeContext.directory === "string" ? runtimeContext.directory : process.cwd()

      const teamRuntime = await resolveTeamRuntimeDetails(args.teamRunId, sessionID, config)
      const message = MessageSchema.parse({
        version: 1,
        messageId: randomUUID(),
        from: teamRuntime.senderName,
        to: args.to,
        body: args.body,
        kind: args.kind ?? "message",
        timestamp: Date.now(),
        correlationId: args.correlationId,
        summary: args.summary,
        references: args.references,
      })

      if (message.kind === "shutdown_request" || message.kind === "shutdown_approved" || message.kind === "shutdown_rejected") {
        throw new Error("must use lifecycle tools for shutdown kinds")
      }

      if (message.to === "*" && !teamRuntime.isLead) {
        throw new BroadcastNotPermittedError()
      }

      const runtimeState = await loadRuntimeState(teamRuntime.teamRunId, config)
      const reservedRecipients = new Set<string>(
        runtimeState.members
          .filter((member) => member.sessionId !== undefined && member.name !== teamRuntime.senderName)
          .map((member) => member.name),
      )

      const result = await sendMessage(message, teamRuntime.teamRunId, config, {
        isLead: teamRuntime.isLead,
        activeMembers: teamRuntime.activeMembers,
        reservedRecipients,
      })

      try {
        await deliverLive(client, message, teamRuntime.teamRunId, result.deliveredTo, config, targetDirectory)
      } catch (liveError) {
        log("[team-mailbox] deliverLive top-level error (message already in inbox, safe to ignore)", {
          error: liveError instanceof Error ? liveError.message : String(liveError),
          teamRunId: teamRuntime.teamRunId,
          messageId: message.messageId,
        })
      }

      return JSON.stringify(result)
    },
  })
}
