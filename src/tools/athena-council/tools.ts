import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { executeCouncil } from "../../agents/athena/council-orchestrator"
import type { CouncilConfig, CouncilMemberConfig } from "../../agents/athena/types"
import type { BackgroundManager } from "../../features/background-agent"
import type { BackgroundOutputClient } from "../background-task/clients"
import { ATHENA_COUNCIL_TOOL_DESCRIPTION_TEMPLATE } from "./constants"
import { createCouncilLauncher } from "./council-launcher"
import { isCouncilRunning, markCouncilDone, markCouncilRunning } from "./session-guard"
import { waitForCouncilSessions } from "./session-waiter"
import { collectCouncilResults } from "./result-collector"
import type { AthenaCouncilToolArgs } from "./types"

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
  client: BackgroundOutputClient
}): ToolDefinition {
  const { backgroundManager, councilConfig, client } = args
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

      if (isCouncilRunning(toolContext.sessionID)) {
        return "Council is already running for this session. Wait for the current council execution to complete."
      }

      markCouncilRunning(toolContext.sessionID)
      try {
        const execution = await executeCouncil({
          question: toolArgs.question,
          council: { members: filteredMembers.members },
          launcher: createCouncilLauncher(backgroundManager),
          parentSessionID: toolContext.sessionID,
          parentMessageID: toolContext.messageID,
          parentAgent: toolContext.agent,
        })

        // Register metadata for UI visibility (makes sessions clickable in TUI).
        const metadataFn = (toolContext as Record<string, unknown>).metadata as
          | ((input: { title?: string; metadata?: Record<string, unknown> }) => Promise<void>)
          | undefined
        if (metadataFn && execution.launched.length > 0) {
          const sessions = await waitForCouncilSessions(
            execution.launched, backgroundManager, toolContext.abort
          )
          for (const session of sessions) {
            await metadataFn({
              title: `Council: ${session.memberName}`,
              metadata: {
                sessionId: session.sessionId,
                agent: "council-member",
                model: session.model,
                description: `Council member: ${session.memberName}`,
              },
            })
          }
        }

        // Wait for all members to complete and collect their actual results.
        // This eliminates the need for Athena to poll background_output repeatedly.
        const collected = await collectCouncilResults(
          execution.launched, backgroundManager, client, toolContext.abort
        )

        return formatCouncilOutput(toolArgs.question, collected.results, execution.failures)
      } catch (error) {
        throw error
      } finally {
        markCouncilDone(toolContext.sessionID)
      }
    },
  })
}

function formatCouncilOutput(
  question: string,
  results: Array<{ name: string; model: string; taskId: string; status: string; content: string }>,
  failures: Array<{ member: { name?: string; model: string }; error: string }>
): string {
  const sections: string[] = []

  sections.push(`## Council Results\n\n**Question:** ${question}\n`)

  for (const result of results) {
    const header = `### ${result.name} (${result.model})`
    if (result.status !== "completed") {
      sections.push(`${header}\n\n*Status: ${result.status}*`)
      continue
    }
    sections.push(`${header}\n\n${result.content}`)
  }

  if (failures.length > 0) {
    const failureLines = failures
      .map((f) => `- **${f.member.name ?? f.member.model}**: ${f.error}`)
      .join("\n")
    sections.push(`### Launch Failures\n\n${failureLines}`)
  }

  return sections.join("\n\n---\n\n")
}
