import type { CompactionAgentConfigCheckpoint } from "../../shared/compaction-agent-config-checkpoint"

export type RecoveryPromptConfig = CompactionAgentConfigCheckpoint & {
  agent: string
}

function isCompactionAgent(agent: string | undefined): boolean {
  return agent?.trim().toLowerCase() === "compaction"
}

function matchesExpectedModel(
  actualModel: CompactionAgentConfigCheckpoint["model"],
  expectedModel: CompactionAgentConfigCheckpoint["model"],
): boolean {
  if (!expectedModel) {
    return true
  }

  return (
    actualModel?.providerID === expectedModel.providerID &&
    actualModel.modelID === expectedModel.modelID
  )
}

function matchesExpectedTools(
  actualTools: CompactionAgentConfigCheckpoint["tools"],
  expectedTools: CompactionAgentConfigCheckpoint["tools"],
): boolean {
  if (!expectedTools) {
    return true
  }

  if (!actualTools) {
    return false
  }

  const expectedEntries = Object.entries(expectedTools)
  if (expectedEntries.length !== Object.keys(actualTools).length) {
    return false
  }

  return expectedEntries.every(
    ([toolName, isAllowed]) => actualTools[toolName] === isAllowed,
  )
}

export function createExpectedRecoveryPromptConfig(
  checkpoint: Pick<RecoveryPromptConfig, "agent"> & CompactionAgentConfigCheckpoint,
  currentPromptConfig: CompactionAgentConfigCheckpoint,
): RecoveryPromptConfig {
  const model = checkpoint.model ?? currentPromptConfig.model
  const tools = checkpoint.tools ?? currentPromptConfig.tools

  return {
    agent: checkpoint.agent,
    ...(model ? { model } : {}),
    ...(tools ? { tools } : {}),
  }
}

export function isPromptConfigRecovered(
  actualPromptConfig: CompactionAgentConfigCheckpoint,
  expectedPromptConfig: RecoveryPromptConfig,
): boolean {
  const actualAgent = actualPromptConfig.agent
  const agentMatches =
    typeof actualAgent === "string" &&
    !isCompactionAgent(actualAgent) &&
    actualAgent.toLowerCase() === expectedPromptConfig.agent.toLowerCase()

  return (
    agentMatches &&
    matchesExpectedModel(actualPromptConfig.model, expectedPromptConfig.model) &&
    matchesExpectedTools(actualPromptConfig.tools, expectedPromptConfig.tools)
  )
}
