import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../../features/background-agent"
import { lookupTeamSession } from "../../features/team-mode/team-session-registry"
import { getAgentSpawnPolicy } from "../../shared/agent-tool-restrictions"
import type { BackgroundCancelArgs } from "./types"
import { BACKGROUND_CANCEL_DESCRIPTION } from "./constants"

export function createBackgroundCancel(manager: BackgroundManager): ToolDefinition {
  return tool({
    description: BACKGROUND_CANCEL_DESCRIPTION,
    args: {
      taskId: tool.schema.string().optional().describe("Task ID to cancel (required if all=false)"),
      all: tool.schema.boolean().optional().describe("Cancel all running background tasks (default: false)"),
    },
    async execute(args: BackgroundCancelArgs, toolContext) {
      try {
        const callerAgent = toolContext.agent
        if (!callerAgent) {
          return "[ERROR] Not authorized: trusted caller identity is required."
        }
        const teamSessionRole = lookupTeamSession(toolContext.sessionID)?.role
        const callerRole = getAgentSpawnPolicy({
          agentName: callerAgent,
          ...(teamSessionRole ? { teamSessionRole } : {}),
        }).callerRole
        if (callerRole !== "coordinator" && callerRole !== "planning_coordinator") {
          return "[ERROR] Not authorized: child roles cannot cancel background tasks."
        }
        const ownedTasks = manager.getTasksByParentSession(toolContext.sessionID)
        const cancelAll = args.all === true

        if (cancelAll) {
          const cancellableTasks = ownedTasks.filter((task) => task.status === "running" || task.status === "pending")

          if (cancellableTasks.length === 0) {
            return `No running or pending background tasks to cancel.`
          }

          const cancelledInfo: Array<{ id: string; description: string; status: string; sessionID?: string }> = []

          for (const task of cancellableTasks) {
            const originalStatus = task.status
            const cancelled = await manager.cancelTask(task.id, toolContext.sessionID, {
              source: "background_cancel",
              abortSession: originalStatus === "running",
              skipNotification: true,
            })
            if (!cancelled) continue
            cancelledInfo.push({
              id: task.id,
              description: task.description,
              status: originalStatus === "pending" ? "pending" : "running",
              sessionID: task.sessionId,
            })
          }

          const tableRows = cancelledInfo
            .map(
              (t) =>
                `| \`${t.id}\` | ${t.description} | ${t.status} | ${t.sessionID ? `\`${t.sessionID}\`` : "(not started)"} |`
            )
            .join("\n")

          const resumableTasks = cancelledInfo.filter((t) => t.sessionID)
          const resumeSection =
            resumableTasks.length > 0
              ? `\n## Continue Instructions

To continue a cancelled task, use:
\`\`\`
task(task_id="<task_id>", prompt="Continue: <your follow-up>")
\`\`\`

Continuable sessions:
${resumableTasks.map((t) => `- \`${t.sessionID}\` (${t.description})`).join("\n")}`
              : ""

          return `Cancelled ${cancelledInfo.length} background task(s):

| Task ID | Description | Status | Session ID |
|---------|-------------|--------|------------|
${tableRows}
${resumeSection}`
        }

        const taskId = args.taskId
        if (!taskId) {
          return `[ERROR] Invalid arguments: Either provide a taskId or set all=true to cancel all running tasks.`
        }

        const task = ownedTasks.find((candidate) => candidate.id === taskId)
        if (!task) {
          return `[ERROR] Task not found or not owned: ${taskId}`
        }

        if (task.status !== "running" && task.status !== "pending") {
          return `[ERROR] Cannot cancel task: current status is "${task.status}".
Only running or pending tasks can be cancelled.`
        }

        const cancelled = await manager.cancelTask(task.id, toolContext.sessionID, {
          source: "background_cancel",
          abortSession: task.status === "running",
          skipNotification: true,
        })
        if (!cancelled) {
          return `[ERROR] Failed to cancel task: ${task.id}`
        }

        if (task.status === "pending") {
          return `Pending task cancelled successfully

Task ID: ${task.id}
Description: ${task.description}
Status: ${task.status}`
        }

        return `Task cancelled successfully

Task ID: ${task.id}
Description: ${task.description}
Session ID: ${task.sessionId}
Status: ${task.status}`
      } catch (error) {
        return `[ERROR] Error cancelling task: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  })
}
