import type { BackgroundTask, LaunchInput } from "../types"

export function buildTaskRecord(input: LaunchInput, id: string, queuedAt: Date): BackgroundTask {
  return {
    id,
    status: "pending",
    queuedAt,
    description: input.description,
    prompt: input.prompt,
    agent: input.agent,
    parentSessionId: input.parentSessionId,
    parentMessageId: input.parentMessageId,
    teamRunId: input.teamRunId,
    parentModel: input.parentModel,
    parentAgent: input.parentAgent,
    parentTools: input.parentTools,
    model: input.model,
    fallbackChain: input.fallbackChain,
    skillContent: input.skillContent,
    sessionPermission: input.sessionPermission,
    userPermission: input.userPermission,
    category: input.category,
    isUnstableAgent: input.isUnstableAgent,
    onSessionCreated: input.onSessionCreated,
  }
}
