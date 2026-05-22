import type { DefaultModeConfig } from "../config/schema/default-mode"
import { getSessionAgent } from "../features/claude-code-session-state"
import { isAgentExcludedFromOmoInjection } from "../shared/excluded-agents"

const ULTRAWORK_MODE_TAG = "<ultrawork-mode>"

export function createSystemTransformHandler(
  defaultMode?: DefaultModeConfig,
  getUltraworkMessage?: (agentName?: string, modelID?: string) => string,
  excludedAgents?: readonly string[],
): (
  input: { sessionID?: string; model: { id: string; providerID: string; [key: string]: unknown } },
  output: { system: string[] },
) => Promise<void> {
  return async (input, output): Promise<void> => {
    if (!defaultMode?.ultrawork || !getUltraworkMessage) return

    // Issue #3735 — respect `excluded_agents`: skip omo's ultrawork tag injection
    // for agents the user opted out of.
    const sessionAgent = input.sessionID ? getSessionAgent(input.sessionID) : undefined
    if (isAgentExcludedFromOmoInjection(sessionAgent, excludedAgents)) return

    // Avoid re-injecting if the ultrawork prompt is already in the system prompt
    // (e.g. after compaction the system prompt is rebuilt and this hook fires again)
    if (output.system.some((part) => part.includes(ULTRAWORK_MODE_TAG))) return

    const modelID = input.model?.id
    const ultraworkMessage = getUltraworkMessage("sisyphus", modelID)
    if (!ultraworkMessage) return

    output.system.push(ultraworkMessage)
  }
}
