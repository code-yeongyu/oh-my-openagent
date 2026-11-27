import type { StartResult } from "../../manager"

type StartedResult = Extract<StartResult, { kind: "started" }>

export type StartLabels = {
  readonly taskSummary?: string
  readonly description?: string
}

export function startedTaskReference(started: StartedResult, label: string | undefined): string {
  const nickname = started.nickname?.trim()
  const primary = label === started.task_id && nickname ? nickname : label
  if (primary === undefined || primary === started.task_id) {
    return nickname === undefined
      ? `${started.task_id} (${started.status})`
      : `${nickname} (${started.task_id}, ${started.status})`
  }
  const nicknameToken = nickname === undefined || nickname === primary ? "" : `${nickname}, `
  return `${primary} (${nicknameToken}${started.task_id}, ${started.status})`
}

export function backgroundStartText(started: StartedResult, labels: StartLabels): string {
  const queue =
    started.queue_position !== undefined
      ? ` queued at position ${started.queue_position}`
      : started.starting === true
        ? ", the task host is still admitting it; a failed start arrives as its notification"
        : ""
  const label = labels.taskSummary ?? labels.description ?? started.name
  const base = `Started task ${startedTaskReference(started, label)}${queue}. Completion is automatically delivered. End your turn if no independent work remains; otherwise keep working. Use task_send only to steer it.`
  return base
}

export function backgroundConversionText(started: StartedResult, labels: StartLabels, budgetSeconds: number): string {
  const prefix = `Foreground wait reached the prompt-cache-safe budget (${budgetSeconds}s) for task ${started.task_id}; the task continues in background. Completion will arrive as a notification; steer with task_send, read with task_output.`
  return `${prefix}\n\n${backgroundStartText(started, labels)}`
}
