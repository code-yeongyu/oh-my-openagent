import type { CompactionAgentConfigCheckpoint } from "../../shared/compaction-agent-config-checkpoint"
import { isCompactionAgent } from "./session-id"

type PromptConfigInfo = {
  agent?: string
  model?: {
    providerID?: string
    modelID?: string
  }
  providerID?: string
  modelID?: string
}

export function resolveValidatedModel(
  info: PromptConfigInfo | undefined,
): CompactionAgentConfigCheckpoint["model"] | undefined {
  if (isCompactionAgent(info?.agent)) {
    return undefined
  }

  const providerID = info?.model?.providerID ?? info?.providerID
  const modelID = info?.model?.modelID ?? info?.modelID

  if (!providerID || !modelID) {
    return undefined
  }

  return { providerID, modelID }
}

export function validateCheckpointModel(
  checkpointModel: CompactionAgentConfigCheckpoint["model"],
  currentModel: CompactionAgentConfigCheckpoint["model"],
): CompactionAgentConfigCheckpoint["model"] | undefined {
  if (!checkpointModel) {
    return undefined
  }

  if (!currentModel) {
    return checkpointModel
  }

  return checkpointModel.providerID === currentModel.providerID &&
    checkpointModel.modelID === currentModel.modelID
    ? checkpointModel
    : undefined
}
