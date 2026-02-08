import { randomUUID } from "crypto"
import type { BackgroundTask, LaunchInput } from "../types"

export function createTask(input: LaunchInput): BackgroundTask {
  return {
    id: `bg_${randomUUID().slice(0, 8)}`,
    status: "pending",
    queuedAt: new Date(),
    description: input.description,
    prompt: input.prompt,
    agent: input.agent,
    parentSessionID: input.parentSessionID,
    parentMessageID: input.parentMessageID,
    parentModel: input.parentModel,
    parentAgent: input.parentAgent,
    model: input.model,
  }
}
