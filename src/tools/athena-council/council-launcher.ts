import type { BackgroundManager } from "../../features/background-agent"
import type { BackgroundTask } from "../../features/background-agent/types"
import type { CouncilMemberConfig } from "../../config/schema/athena"
import { parseModelString } from "../delegate-task/model-string-parser"
import {
  ATHENA_JUNIOR_COUNCIL_MEMBER_KEY_PREFIX,
  buildCouncilMemberAgentKey,
  COUNCIL_MEMBER_KEY_PREFIX,
} from "../../agents/builtin-agents/council-member-agents"
import { normalizeMemberId } from "../../shared/member-id-normalizer"
import { COUNCIL_DEFAULTS } from "../../agents/athena/constants"

export interface CouncilLaunchContext {
  parentSessionID: string
  parentMessageID: string
  parentAgent?: string
}

interface LaunchOutcome {
  member: CouncilMemberConfig
  task: BackgroundTask
}

function getCouncilMemberKeyPrefix(parentAgent?: string): string {
  return parentAgent?.toLowerCase().includes("athena-junior")
    ? ATHENA_JUNIOR_COUNCIL_MEMBER_KEY_PREFIX
    : COUNCIL_MEMBER_KEY_PREFIX
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

  const normalizedName = normalizeMemberId(member.name)
  const agentKey = buildCouncilMemberAgentKey(
    normalizedName,
    getCouncilMemberKeyPrefix(context.parentAgent)
  )
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
    ttl: COUNCIL_DEFAULTS.COUNCIL_MEMBER_TTL_MS,
  })

  return { member, task }
}
