import { tool, type ToolDefinition, type ToolContext } from "@opencode-ai/plugin"
import type { TeamModeManager } from "../../features/team-mode"

function resolveTeamId(
  manager: TeamModeManager,
  sessionID: string,
  explicitTeamId?: string,
): string | null {
  if (explicitTeamId) return explicitTeamId
  return manager.findActiveTeamForLeaderSession(sessionID)?.manifest.team_id ?? null
}

function getRuntimeOrError(manager: TeamModeManager, teamId: string): string | ReturnType<TeamModeManager["readRuntime"]> {
  const runtime = manager.readRuntime(teamId)
  return runtime ?? JSON.stringify({ error: "team_not_found", team_id: teamId })
}

export function createTeamModeTools(manager: TeamModeManager): Record<string, ToolDefinition> {
  const team_mode_status = tool({
    description: "Read durable Team Mode runtime state for the active leader session or an explicit team_id.",
    args: {
      team_id: tool.schema.string().optional().describe("Optional Team Mode runtime id"),
    },
    execute: async (args: { team_id?: string }, toolContext: ToolContext): Promise<string> => {
      const teamId = resolveTeamId(manager, toolContext.sessionID, args.team_id)
      if (!teamId) return JSON.stringify({ error: "no_active_team" })
      const runtime = getRuntimeOrError(manager, teamId)
      return typeof runtime === "string"
        ? runtime
        : JSON.stringify({ team_id: teamId, state_path: manager.getTeamStatePath(teamId), runtime })
    },
  })

  const team_mode_claim_task = tool({
    description: "Claim the next pending durable Team Mode task for a worker.",
    args: {
      team_id: tool.schema.string().optional().describe("Optional Team Mode runtime id"),
      worker_id: tool.schema.string().describe("Worker id such as worker-1"),
    },
    execute: async (args: { team_id?: string; worker_id: string }, toolContext: ToolContext): Promise<string> => {
      const teamId = resolveTeamId(manager, toolContext.sessionID, args.team_id)
      if (!teamId) return JSON.stringify({ error: "no_active_team" })
      return JSON.stringify(manager.claimNextTask(teamId, { workerId: args.worker_id }))
    },
  })

  const team_mode_transition_task = tool({
    description: "Apply a claim-safe Team Mode task transition.",
    args: {
      team_id: tool.schema.string().optional().describe("Optional Team Mode runtime id"),
      task_id: tool.schema.string().describe("Task id such as task-1"),
      worker_id: tool.schema.string().describe("Worker id such as worker-1"),
      claim_token: tool.schema.string().describe("Claim token returned from team_mode_claim_task"),
      from_status: tool.schema.enum(["in_progress", "blocked", "completed", "failed"]).describe("Current expected status"),
      to_status: tool.schema.enum(["blocked", "in_progress", "completed", "failed"]).describe("Next status"),
      expected_version: tool.schema.number().describe("Expected task version before transition"),
      result: tool.schema.string().optional().describe("Result text for completed transitions"),
      error: tool.schema.string().optional().describe("Error text for failed transitions"),
    },
    execute: async (
      args: {
        team_id?: string
        task_id: string
        worker_id: string
        claim_token: string
        from_status: "in_progress" | "blocked" | "completed" | "failed"
        to_status: "blocked" | "in_progress" | "completed" | "failed"
        expected_version: number
        result?: string
        error?: string
      },
      toolContext: ToolContext,
    ): Promise<string> => {
      const teamId = resolveTeamId(manager, toolContext.sessionID, args.team_id)
      if (!teamId) return JSON.stringify({ error: "no_active_team" })
      return JSON.stringify(
        manager.transitionTask(teamId, {
          taskId: args.task_id,
          workerId: args.worker_id,
          claimToken: args.claim_token,
          fromStatus: args.from_status,
          toStatus: args.to_status,
          expectedVersion: args.expected_version,
          ...(args.result ? { result: args.result } : {}),
          ...(args.error ? { error: args.error } : {}),
        }),
      )
    },
  })

  const team_mode_mailbox = tool({
    description: "Send or acknowledge durable Team Mode mailbox messages.",
    args: {
      team_id: tool.schema.string().optional().describe("Optional Team Mode runtime id"),
      action: tool.schema.enum(["send", "deliver"]).describe("Mailbox action"),
      from_worker: tool.schema.string().optional().describe("Sender worker id for send action"),
      to_worker: tool.schema.string().optional().describe("Recipient worker id for send action"),
      body: tool.schema.string().optional().describe("Message body for send action"),
      message_id: tool.schema.string().optional().describe("Message id for deliver action"),
    },
    execute: async (
      args: {
        team_id?: string
        action: "send" | "deliver"
        from_worker?: string
        to_worker?: string
        body?: string
        message_id?: string
      },
      toolContext: ToolContext,
    ): Promise<string> => {
      const teamId = resolveTeamId(manager, toolContext.sessionID, args.team_id)
      if (!teamId) return JSON.stringify({ error: "no_active_team" })
      if (args.action === "send") {
        if (!args.from_worker || !args.to_worker || !args.body) {
          return JSON.stringify({ error: "missing_send_fields" })
        }
        return JSON.stringify(
          manager.appendMailboxMessage(teamId, {
            fromWorker: args.from_worker,
            toWorker: args.to_worker,
            body: args.body,
          }),
        )
      }
      if (!args.message_id) return JSON.stringify({ error: "missing_message_id" })
      return JSON.stringify(manager.markMailboxMessageDelivered(teamId, args.message_id))
    },
  })

  const team_mode_shutdown = tool({
    description: "Request graceful or abort shutdown for a durable Team Mode runtime.",
    args: {
      team_id: tool.schema.string().optional().describe("Optional Team Mode runtime id"),
      requested_by: tool.schema.string().describe("Worker requesting shutdown"),
      mode: tool.schema.enum(["graceful", "abort"]).optional().describe("Shutdown mode"),
    },
    execute: async (
      args: { team_id?: string; requested_by: string; mode?: "graceful" | "abort" },
      toolContext: ToolContext,
    ): Promise<string> => {
      const teamId = resolveTeamId(manager, toolContext.sessionID, args.team_id)
      if (!teamId) return JSON.stringify({ error: "no_active_team" })
      return JSON.stringify(
        manager.requestShutdown(teamId, {
          requestedBy: args.requested_by,
          ...(args.mode ? { mode: args.mode } : {}),
        }),
      )
    },
  })

  return {
    team_mode_status,
    team_mode_claim_task,
    team_mode_transition_task,
    team_mode_mailbox,
    team_mode_shutdown,
  }
}
