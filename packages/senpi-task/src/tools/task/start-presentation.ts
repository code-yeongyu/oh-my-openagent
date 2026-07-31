import type { StartResult } from "../../manager"

type StartedResult = Extract<StartResult, { kind: "started" }>

export function backgroundStartText(started: StartedResult, description: string | undefined): string {
  const queue = started.queue_position !== undefined ? ` queued at position ${started.queue_position}` : ""
  const label = description ?? started.name
  if (label === started.task_id) {
    return `Started task ${started.task_id} (${started.status})${queue}. Completion is automatically delivered. End your turn if no independent work remains; otherwise keep working. Use task_send only to steer it.`
  }
  return `Started task ${label} (${started.task_id}, ${started.status})${queue}. Completion is automatically delivered. End your turn if no independent work remains; otherwise keep working. Use task_send only to steer it.`
}

export function backgroundConversionText(
  started: StartedResult,
  description: string | undefined,
  budgetSeconds: number,
): string {
  const prefix = `Foreground wait reached the prompt-cache-safe budget (${budgetSeconds}s) for task ${started.task_id}; the task continues in background. Completion will arrive as a notification; steer with task_send, read with task_output.`
  return `${prefix}\n\n${backgroundStartText(started, description)}`
}
