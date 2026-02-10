import { getTaskToastManager } from "../task-toast-manager"
import { log } from "../../shared"

import type { BackgroundTask } from "./types"
import type { LaunchInput } from "./types"

type QueueItem = {
  task: BackgroundTask
  input: LaunchInput
}

export function launchBackgroundTask(args: {
  input: LaunchInput
  tasks: Map<string, BackgroundTask>
  pendingByParent: Map<string, Set<string>>
  queuesByKey: Map<string, QueueItem[]>
  getConcurrencyKeyFromInput: (input: LaunchInput) => string
  processKey: (key: string) => void
}): BackgroundTask {
  const { input, tasks, pendingByParent, queuesByKey, getConcurrencyKeyFromInput, processKey } = args

  log("[background-agent] launch() called with:", {
    agent: input.agent,
    model: input.model,
    description: input.description,
    parentSessionID: input.parentSessionID,
  })

  if (!input.agent || input.agent.trim() === "") {
    throw new Error("Agent parameter is required")
  }

  const task: BackgroundTask = {
    id: `bg_${crypto.randomUUID().slice(0, 8)}`,
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
    category: input.category,
  }

  tasks.set(task.id, task)

  if (input.parentSessionID) {
    const pending = pendingByParent.get(input.parentSessionID) ?? new Set<string>()
    pending.add(task.id)
    pendingByParent.set(input.parentSessionID, pending)
  }

  const key = getConcurrencyKeyFromInput(input)
  const queue = queuesByKey.get(key) ?? []
  queue.push({ task, input })
  queuesByKey.set(key, queue)

  log("[background-agent] Task queued:", { taskId: task.id, key, queueLength: queue.length })

  const toastManager = getTaskToastManager()
  if (toastManager) {
    toastManager.addTask({
      id: task.id,
      description: input.description,
      agent: input.agent,
      isBackground: true,
      status: "queued",
      skills: input.skills,
    })
  }

  processKey(key)
  return task
}
