import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { executeCouncil } from "../../agents/athena/council-orchestrator"
import type { CouncilConfig, CouncilMemberConfig } from "../../agents/athena/types"
import type { BackgroundManager } from "../../features/background-agent"
import { ATHENA_COUNCIL_TOOL_DESCRIPTION_TEMPLATE } from "./constants"
import { createCouncilLauncher } from "./council-launcher"
import { waitForCouncilSessions } from "./session-waiter"
import type { AthenaCouncilToolArgs } from "./types"
import { storeToolMetadata } from "../../features/tool-metadata-store"

function getToolContextProperty(toolContext: unknown, key: string): unknown {
  if (typeof toolContext === "object" && toolContext !== null && key in toolContext) {
    return (toolContext as Record<string, unknown>)[key]
  }
  return undefined
}

function isCouncilConfigured(councilConfig: CouncilConfig | undefined): councilConfig is CouncilConfig {
  return Boolean(councilConfig && councilConfig.members.length > 0)
}

interface FilterCouncilMembersResult {
  members: CouncilMemberConfig[]
  error?: string
}

function buildSingleMemberSelectionError(members: CouncilMemberConfig[]): string {
  const availableNames = members.map((member) => member.name ?? member.model).join(", ")
  return `athena_council runs one member per call. Pass exactly one member in members (single-item array). Available members: ${availableNames}.`
}

export function filterCouncilMembers(
  members: CouncilMemberConfig[],
  selectedNames: string[] | undefined
): FilterCouncilMembersResult {
  if (!selectedNames || selectedNames.length === 0) {
    return {
      members: [],
      error: buildSingleMemberSelectionError(members),
    }
  }

  const memberLookup = new Map<string, CouncilMemberConfig>()
  members.forEach((member) => {
    memberLookup.set(member.model.toLowerCase(), member)
    if (member.name) {
      memberLookup.set(member.name.toLowerCase(), member)
    }
  })

  const unresolved: string[] = []
  const filteredMembers: CouncilMemberConfig[] = []
  const includedMembers = new Set<CouncilMemberConfig>()

  selectedNames.forEach((selectedName) => {
    const selectedKey = selectedName.toLowerCase()
    const matchedMember = memberLookup.get(selectedKey)
    if (!matchedMember) {
      unresolved.push(selectedName)
      return
    }

    if (includedMembers.has(matchedMember)) {
      return
    }

    includedMembers.add(matchedMember)
    filteredMembers.push(matchedMember)
  })

  if (unresolved.length > 0) {
    const availableDescriptions = members
      .map((member) => {
        if (member.name) {
          return `${member.name} (${member.model})`
        }
        return member.model
      })
      .join(", ")
    return {
      members: [],
      error: `Unknown council members: ${unresolved.join(", ")}. Available: ${availableDescriptions}.`,
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
        .describe("Single-item list containing exactly one council member name or model ID."),
    },
    async execute(toolArgs: AthenaCouncilToolArgs, toolContext) {
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

      const waitResult = await waitForCouncilSessions(execution.launched, backgroundManager, toolContext.abort)
      const launchedSession = waitResult.sessions.find((session) => session.taskId === launchedTaskId)
      const sessionId = launchedSession?.sessionId ?? "pending"

      const metadataFn = getToolContextProperty(toolContext, "metadata") as
        | ((input: { title?: string; metadata?: Record<string, unknown> }) => Promise<void>)
        | undefined
      if (metadataFn) {
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
          await metadataFn(memberMetadata)

          const callID = getToolContextProperty(toolContext, "callID")
          if (typeof callID === "string") {
            storeToolMetadata(toolContext.sessionID, callID, memberMetadata)
          }
        } catch {
          // Metadata storage is best-effort — don't mask successful council launch
        }
      }

      return `Council member launched in background.

Task ID: ${launchedTaskId}
Session ID: ${sessionId}
Member: ${launchedMemberName}
Model: ${launchedMemberModel}
Status: running

Use \`background_output\` with task_id="${launchedTaskId}" to collect this member's result.
- block=true: Wait for completion and return the result
- full_session=true: Include full session messages when needed

<task_metadata>
session_id: ${sessionId}
</task_metadata>`
    },
  })
}

function formatCouncilLaunchFailure(
  failures: Array<{ member: { name?: string; model: string }; error: string }>
): string {
  if (failures.length === 0) {
    return "Failed to launch council member."
  }

  const failureLines = failures
    .map((failure) => `- **${failure.member.name ?? failure.member.model}**: ${failure.error}`)
    .join("\n")

  return `Failed to launch council member.\n\n### Launch Failures\n\n${failureLines}`
}
