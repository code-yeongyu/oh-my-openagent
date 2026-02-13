import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { executeCouncil } from "../../agents/athena/council-orchestrator"
import type { CouncilConfig, CouncilMemberConfig } from "../../agents/athena/types"
import type { BackgroundManager } from "../../features/background-agent"
import { ATHENA_COUNCIL_TOOL_DESCRIPTION_TEMPLATE } from "./constants"
import { createCouncilLauncher } from "./council-launcher"
import type { AthenaCouncilLaunchResult, AthenaCouncilToolArgs } from "./types"

/** Tracks active council executions per session to prevent duplicate launches. */
const activeCouncilSessions = new Set<string>()

function isCouncilConfigured(councilConfig: CouncilConfig | undefined): councilConfig is CouncilConfig {
  return Boolean(councilConfig && councilConfig.members.length > 0)
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

function buildToolDescription(councilConfig: CouncilConfig | undefined): string {
  const memberList = councilConfig?.members.length
    ? councilConfig.members.map((m) => `- ${m.name ?? m.model}`).join("\n")
    : "No members configured."

  return ATHENA_COUNCIL_TOOL_DESCRIPTION_TEMPLATE.replace("{members}", `Available council members:\n${memberList}`)
}

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

        const launchResult: AthenaCouncilLaunchResult = {
          launched: execution.responses.filter((response) => response.taskId.length > 0).length,
          members: execution.responses
            .filter((response) => response.taskId.length > 0)
            .map((response) => ({
              task_id: response.taskId,
              name: response.member.name ?? response.member.model,
              model: response.member.model,
              status: "running",
            })),
          failed: execution.responses
            .filter((response) => response.taskId.length === 0)
            .map((response) => ({
              name: response.member.name ?? response.member.model,
              model: response.member.model,
              error: response.error ?? "Launch failed",
            })),
        }

        activeCouncilSessions.delete(toolContext.sessionID)
        return JSON.stringify(launchResult)
      } catch (error) {
        activeCouncilSessions.delete(toolContext.sessionID)
        throw error
      }
    },
  })
}
