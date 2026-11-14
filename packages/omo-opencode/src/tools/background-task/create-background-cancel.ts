import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../../features/background-agent"
import type { MonitorManager } from "../../features/monitor/types"
import type { BackgroundCancelArgs } from "./types"
import type { BackgroundCancelClient } from "./clients"
import { BACKGROUND_CANCEL_DESCRIPTION } from "./constants"

function isRunningMonitor(status: string): boolean {
  return status === "running" || status === "starting"
}

/** Stops one of the session's monitors, or explains why it is not running; undefined when the session has no monitor with that id. */
async function cancelMonitor(
  monitorManager: MonitorManager | undefined,
  id: string,
  sessionID: string,
): Promise<string | undefined> {
  const record = monitorManager?.get(id)
  if (!monitorManager || !record || record.parentSessionId !== sessionID) return undefined
  if (!isRunningMonitor(record.status)) {
    return `[ERROR] Cannot stop monitor: current status is "${record.status}".`
  }
  await monitorManager.stop(id)
  return `Monitor stopped

Monitor ID: ${record.id}
Description: ${record.label}
Matched lines: ${record.counters.matchedLines}`
}

export function createBackgroundCancel(
  manager: BackgroundManager,
  _client: BackgroundCancelClient,
  monitorManager?: MonitorManager,
): ToolDefinition {
  return tool({
    description: BACKGROUND_CANCEL_DESCRIPTION,
    args: {
      taskId: tool.schema.string().optional().describe("Task or monitor ID to stop (required if all=false)"),
      all: tool.schema
        .boolean()
        .optional()
        .describe("Stop all running background tasks and monitors of this session (default: false)"),
    },
    async execute(args: BackgroundCancelArgs, toolContext) {
      try {
        const cancelAll = args.all === true

        if (cancelAll) {
          const tasks = manager.getAllDescendantTasks(toolContext.sessionID)
          const cancellableTasks = tasks.filter(
            (t: { status: string }) => t.status === "running" || t.status === "pending",
          )

          const runningMonitors = (monitorManager?.list(toolContext.sessionID) ?? []).filter((record) =>
            isRunningMonitor(record.status),
          )
          for (const record of runningMonitors) {
            await monitorManager?.stop(record.id)
          }
          const monitorsLine =
            runningMonitors.length > 0
              ? `Stopped ${runningMonitors.length} monitor(s): ${runningMonitors.map((record) => `\`${record.id}\``).join(", ")}\n\n`
              : ""

          if (cancellableTasks.length === 0) {
            return monitorsLine ? monitorsLine.trimEnd() : `No running or pending background tasks to cancel.`
          }

          const cancelledInfo: Array<{ id: string; description: string; status: string; sessionID?: string }> = []

          for (const task of cancellableTasks) {
            const originalStatus = task.status
            const cancelled = await manager.cancelTask(task.id, {
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
                `| \`${t.id}\` | ${t.description} | ${t.status} | ${t.sessionID ? `\`${t.sessionID}\`` : "(not started)"} |`,
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

          return `${monitorsLine}Cancelled ${cancelledInfo.length} background task(s):

| Task ID | Description | Status | Session ID |
|---------|-------------|--------|------------|
${tableRows}
${resumeSection}`
        }

        const taskId = args.taskId
        if (!taskId) {
          return `[ERROR] Invalid arguments: Either provide a taskId or set all=true to cancel all running tasks.`
        }

        const task = manager.getTask(taskId)
        if (!task) {
          const monitorResult = await cancelMonitor(monitorManager, taskId, toolContext.sessionID)
          return monitorResult ?? `[ERROR] Task not found: ${taskId}`
        }

        if (task.status !== "running" && task.status !== "pending") {
          return `[ERROR] Cannot cancel task: current status is "${task.status}".
Only running or pending tasks can be cancelled.`
        }

        const cancelled = await manager.cancelTask(task.id, {
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
