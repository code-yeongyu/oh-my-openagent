export type CompactionAgentConfigCheckpoint = {
  agent?: string
  model?: { providerID: string; modelID: string }
  tools?: Record<string, boolean>
}

const checkpoints = new Map<string, CompactionAgentConfigCheckpoint>()

function cloneCheckpoint(
  checkpoint: CompactionAgentConfigCheckpoint,
): CompactionAgentConfigCheckpoint {
  return {
    ...(checkpoint.agent ? { agent: checkpoint.agent } : {}),
    ...(checkpoint.model
      ? {
          model: {
            providerID: checkpoint.model.providerID,
            modelID: checkpoint.model.modelID,
          },
        }
      : {}),
    ...(checkpoint.tools ? { tools: { ...checkpoint.tools } } : {}),
  }
}

export function setCompactionAgentConfigCheckpoint(
  sessionID: string,
  checkpoint: CompactionAgentConfigCheckpoint,
): void {
  checkpoints.set(sessionID, cloneCheckpoint(checkpoint))
}

export function getCompactionAgentConfigCheckpoint(
  sessionID: string,
): CompactionAgentConfigCheckpoint | undefined {
  const checkpoint = checkpoints.get(sessionID)
  return checkpoint ? cloneCheckpoint(checkpoint) : undefined
}

export function clearCompactionAgentConfigCheckpoint(sessionID: string): void {
  checkpoints.delete(sessionID)
}
