import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { executeCouncil } from "../../agents/athena/council-orchestrator"
import type { CouncilConfig } from "../../agents/athena/types"
import type { BackgroundManager } from "../../features/background-agent"
import { createCouncilLauncher } from "./council-launcher"
import { waitForCouncilSessions } from "./session-waiter"
import type { AthenaCouncilToolArgs, AthenaCouncilToolContext } from "./types"
import { storeToolMetadata } from "../../features/tool-metadata-store"
import { log } from "../../shared/logger"
import {
  isCouncilConfigured,
  filterCouncilMembers,
  buildSingleMemberSelectionError,
  buildToolDescription,
  formatCouncilLaunchFailure,
} from "./tool-helpers"

export function createAthenaCouncilTool(args: {
  backgroundManager: BackgroundManager
  councilConfig: CouncilConfig | undefined
}): ToolDefinition {
  const { backgroundManager, councilConfig } = args
  const description = buildToolDescription(councilConfig)

  return tool({
    description,
    args: {
      question: tool.schema.string().describe("The question to send to all council members"),
      members: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Single-item list containing exactly one council member name or model ID."),
    },
    async execute(toolArgs: AthenaCouncilToolArgs, toolContext: AthenaCouncilToolContext) {
      if (!isCouncilConfigured(councilConfig)) {
        return "Athena council is not configured. Add council members to agents.athena.council.members in .opencode/oh-my-opencode.jsonc."
      }

      const filteredMembers = filterCouncilMembers(councilConfig.members, toolArgs.members)
      if (filteredMembers.error) {
        return filteredMembers.error
      }
      if (filteredMembers.members.length !== 1) {
        return buildSingleMemberSelectionError(councilConfig.members)
      }

      const execution = await executeCouncil({
        question: toolArgs.question,
        council: { members: filteredMembers.members },
        launcher: createCouncilLauncher(backgroundManager),
        parentSessionID: toolContext.sessionID,
        parentMessageID: toolContext.messageID,
        parentAgent: toolContext.agent,
      })

      if (execution.launched.length === 0) {
        return formatCouncilLaunchFailure(execution.failures)
      }

      const launched = execution.launched[0]
      const launchedMemberName = launched?.member.name ?? launched?.member.model
      const launchedMemberModel = launched?.member.model ?? "unknown"
      const launchedTaskId = launched?.taskId ?? "unknown"

      log("[athena-council] Launching council member", { member: launchedMemberName, model: launchedMemberModel, taskId: launchedTaskId })

      const waitResult = await waitForCouncilSessions(execution.launched, backgroundManager, toolContext.abort)
      const launchedSession = waitResult.sessions.find((session) => session.taskId === launchedTaskId)
      const sessionId = launchedSession?.sessionId ?? "pending"

      let statusNote = ""
      if (waitResult.timedOut) {
        statusNote = "\nNote: Session creation timed out. The task is still running — use background_output to check status."
      } else if (waitResult.aborted) {
        statusNote = "\nNote: Session wait was aborted. The task may still be running."
      }

      log("[athena-council] Session resolved", { taskId: launchedTaskId, sessionId })

      if (toolContext.metadata) {
        const memberMetadata = {
          title: `Council: ${launchedMemberName}`,
          metadata: {
            sessionId,
            agent: "council-member",
            model: launchedMemberModel,
            description: `Council member: ${launchedMemberName}`,
          },
        }
        try {
          await toolContext.metadata(memberMetadata)

          if (toolContext.callID) {
            storeToolMetadata(toolContext.sessionID, toolContext.callID, memberMetadata)
          }
        } catch (error) {
          log("[athena-council] Metadata storage failed (best-effort)", { error: error instanceof Error ? error.message : String(error) })
        }
      }

      return `Council member launched in background.

Task ID: ${launchedTaskId}
Session ID: ${sessionId}
Member: ${launchedMemberName}
Model: ${launchedMemberModel}
Status: running${statusNote}

Use \`background_output\` with task_id="${launchedTaskId}" to collect this member's result.
- block=true: Wait for completion and return the result
- full_session=true: Include full session messages when needed

<task_metadata>
session_id: ${sessionId}
</task_metadata>`
    },
  })
}
