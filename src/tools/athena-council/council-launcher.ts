import type { BackgroundManager } from "../../features/background-agent"
import type { BackgroundTask } from "../../features/background-agent/types"
import type { CouncilMemberConfig } from "../../config/schema/athena"
import { parseModelString } from "../delegate-task/model-string-parser"
import { COUNCIL_MEMBER_KEY_PREFIX } from "../../agents/builtin-agents/council-member-agents"

export interface CouncilLaunchContext {
  parentSessionID: string
  parentMessageID: string
  parentAgent?: string
}

interface LaunchOutcome {
  member: CouncilMemberConfig
  task: BackgroundTask
}

/**
 * Launches a single council member as a background task.
 * The agent key follows the "Council: <name>" pattern used by council-member-agents.ts.
 */
export async function launchCouncilMember(
  member: CouncilMemberConfig,
  prompt: string,
  manager: BackgroundManager,
  context: CouncilLaunchContext,
): Promise<LaunchOutcome> {
  const parsed = parseModelString(member.model)
  if (!parsed) {
    throw new Error(`Invalid model format: "${member.model}" (expected "provider/model-id")`)
  }

  const agentKey = `${COUNCIL_MEMBER_KEY_PREFIX}${member.name}`
  const memberName = member.name ?? member.model

  const task = await manager.launch({
    description: `Council member: ${memberName}`,
    prompt,
    agent: agentKey,
    parentSessionID: context.parentSessionID,
    parentMessageID: context.parentMessageID,
    parentAgent: context.parentAgent,
    writeOutputToFile: true,
    model: {
      providerID: parsed.providerID,
      modelID: parsed.modelID,
      ...(member.variant ? { variant: member.variant } : {}),
    },
  })

  return { member, task }
}
