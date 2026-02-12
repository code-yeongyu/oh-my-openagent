import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { executeCouncil } from "../../agents/athena/council-orchestrator"
import type { CouncilConfig, CouncilMemberConfig, CouncilMemberResponse } from "../../agents/athena/types"
import type { BackgroundManager, BackgroundTask, BackgroundTaskStatus } from "../../features/background-agent"
import { ATHENA_COUNCIL_TOOL_DESCRIPTION } from "./constants"
import { createCouncilLauncher } from "./council-launcher"
import type { AthenaCouncilToolArgs } from "./types"

const WAIT_INTERVAL_MS = 500
const WAIT_TIMEOUT_MS = 600000
const TERMINAL_STATUSES: Set<BackgroundTaskStatus> = new Set(["completed", "error", "cancelled", "interrupt"])

/** Tracks active council executions per session to prevent duplicate launches. */
const activeCouncilSessions = new Set<string>()

function isCouncilConfigured(councilConfig: CouncilConfig | undefined): councilConfig is CouncilConfig {
  return Boolean(councilConfig && councilConfig.members.length > 0)
}

async function waitForTasksToSettle(
  taskIds: string[],
  manager: BackgroundManager,
  abortSignal: AbortSignal
): Promise<Map<string, BackgroundTask>> {
  const settledIds = new Set<string>()
  const latestTasks = new Map<string, BackgroundTask>()
  const startedAt = Date.now()

  while (settledIds.size < taskIds.length && Date.now() - startedAt < WAIT_TIMEOUT_MS) {
    if (abortSignal.aborted) {
      break
    }

    for (const taskId of taskIds) {
      if (settledIds.has(taskId)) {
        continue
      }

      const task = manager.getTask(taskId)
      if (!task) {
        continue
      }

      latestTasks.set(taskId, task)
      if (TERMINAL_STATUSES.has(task.status)) {
        settledIds.add(taskId)
      }
    }

    if (settledIds.size < taskIds.length) {
      await new Promise((resolve) => setTimeout(resolve, WAIT_INTERVAL_MS))
    }
  }

  return latestTasks
}

function mapTaskStatus(status: BackgroundTaskStatus): CouncilMemberResponse["status"] {
  if (status === "completed") {
    return "completed"
  }

  if (status === "cancelled" || status === "interrupt") {
    return "timeout"
  }

  return "error"
}

function refreshResponse(response: CouncilMemberResponse, task: BackgroundTask | undefined): CouncilMemberResponse {
  if (!task) {
    return response
  }

  const status = mapTaskStatus(task.status)
  const durationMs =
    task.startedAt && task.completedAt
      ? Math.max(0, task.completedAt.getTime() - task.startedAt.getTime())
      : response.durationMs

  return {
    ...response,
    status,
    response: status === "completed" ? task.result : undefined,
    error: status === "completed" ? undefined : (task.error ?? `Task status: ${task.status}`),
    durationMs,
  }
}

function formatCouncilOutput(responses: CouncilMemberResponse[], totalMembers: number): string {
  const completedCount = responses.filter((item) => item.status === "completed").length
  const lines = responses.map((item, index) => {
    const model = item.member.name ?? item.member.model
    const content = item.status === "completed"
      ? (item.response ?? "(no response)")
      : (item.error ?? "Unknown error")

    return `${index + 1}. ${model}\n   Status: ${item.status}\n   Result: ${content}`
  })

  return `${completedCount}/${totalMembers} council members completed.\n\n${lines.join("\n\n")}`
}

interface FilterCouncilMembersResult {
  members: CouncilMemberConfig[]
  error?: string
}

export function filterCouncilMembers(
  members: CouncilMemberConfig[],
  selectedNames: string[] | undefined
): FilterCouncilMembersResult {
  if (!selectedNames || selectedNames.length === 0) {
    return { members }
  }

  const memberLookup = new Map<string, CouncilMemberConfig>()
  members.forEach((member) => {
    const key = (member.name ?? member.model).toLowerCase()
    memberLookup.set(key, member)
  })

  const unresolved: string[] = []
  const filteredMembers: CouncilMemberConfig[] = []
  const includedMemberKeys = new Set<string>()

  selectedNames.forEach((selectedName) => {
    const selectedKey = selectedName.toLowerCase()
    const matchedMember = memberLookup.get(selectedKey)
    if (!matchedMember) {
      unresolved.push(selectedName)
      return
    }

    const memberKey = matchedMember.model
    if (includedMemberKeys.has(memberKey)) {
      return
    }

    includedMemberKeys.add(memberKey)
    filteredMembers.push(matchedMember)
  })

  if (unresolved.length > 0) {
    const availableNames = members.map((member) => member.name ?? member.model).join(", ")
    return {
      members: [],
      error: `Unknown council members: ${unresolved.join(", ")}. Available members: ${availableNames}.`,
    }
  }

  return { members: filteredMembers }
}

export function createAthenaCouncilTool(args: {
  backgroundManager: BackgroundManager
  councilConfig: CouncilConfig | undefined
}): ToolDefinition {
  const { backgroundManager, councilConfig } = args

  return tool({
    description: ATHENA_COUNCIL_TOOL_DESCRIPTION,
    args: {
      question: tool.schema.string().describe("The question to send to all council members"),
      members: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Optional list of council member names or models to consult. Defaults to all configured members."),
    },
    async execute(toolArgs: AthenaCouncilToolArgs, toolContext) {
      if (!isCouncilConfigured(councilConfig)) {
        return "Athena council not configured. Add agents.athena.council.members to your config."
      }

      const filteredMembers = filterCouncilMembers(councilConfig.members, toolArgs.members)
      if (filteredMembers.error) {
        return filteredMembers.error
      }

      if (activeCouncilSessions.has(toolContext.sessionID)) {
        return "Council is already running for this session. Wait for the current council execution to complete."
      }

      activeCouncilSessions.add(toolContext.sessionID)
      try {
        const execution = await executeCouncil({
          question: toolArgs.question,
          council: { members: filteredMembers.members },
          launcher: createCouncilLauncher(backgroundManager),
          parentSessionID: toolContext.sessionID,
          parentMessageID: toolContext.messageID,
          parentAgent: toolContext.agent,
        })

        const taskIds = execution.responses
          .map((response) => response.taskId)
          .filter((taskId) => taskId.length > 0)

        const latestTasks = await waitForTasksToSettle(taskIds, backgroundManager, toolContext.abort)
        const refreshedResponses = execution.responses.map((response) =>
          response.taskId ? refreshResponse(response, latestTasks.get(response.taskId)) : response
        )

        return formatCouncilOutput(refreshedResponses, execution.totalMembers)
      } finally {
        activeCouncilSessions.delete(toolContext.sessionID)
      }
    },
  })
}
