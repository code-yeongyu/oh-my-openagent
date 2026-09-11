import { legacyAgentNameNotice } from "../../agents/legacy-agent-names"

import type { StartResult } from "../../manager"

type StartedResult = Extract<StartResult, { kind: "started" }>

// A retired curated agent id plus its canonical replacement, threaded from the task target
// validation so the start text can name both in the deprecation notice.
export type LegacySubagentAlias = {
  readonly legacy: string
  readonly canonical: string
}

export type StartLabels = {
  readonly taskSummary?: string
  readonly description?: string
  // Present when the caller submitted a retired curated agent id: exactly one deprecation line is
  // appended to the start text naming the canonical replacement.
  readonly legacyAlias?: LegacySubagentAlias
}

// One deprecation line per DISTINCT retired id: a batch that repeats the same legacy id lists its
// deprecation once (each item's deprecation surfaces exactly once), and no aliases means no line.
export function appendLegacyNoticeLines(text: string, aliases: readonly LegacySubagentAlias[]): string {
  if (aliases.length === 0) return text
  const seen = new Set<string>()
  const lines: string[] = []
  for (const alias of aliases) {
    if (seen.has(alias.legacy)) continue
    seen.add(alias.legacy)
    lines.push(legacyAgentNameNotice(alias.legacy, alias.canonical))
  }
  return `${text}\n${lines.join("\n")}`
}

export function backgroundStartText(started: StartedResult, labels: StartLabels): string {
  const queue = started.queue_position !== undefined ? ` queued at position ${started.queue_position}` : ""
  const label = labels.taskSummary ?? labels.description ?? started.name
  const base =
    label === started.task_id
      ? `Started task ${started.task_id} (${started.status})${queue}. Completion is automatically delivered. End your turn if no independent work remains; otherwise keep working. Use task_send only to steer it.`
      : `Started task ${label} (${started.task_id}, ${started.status})${queue}. Completion is automatically delivered. End your turn if no independent work remains; otherwise keep working. Use task_send only to steer it.`
  return appendLegacyNoticeLines(base, labels.legacyAlias === undefined ? [] : [labels.legacyAlias])
}

export function backgroundConversionText(
  started: StartedResult,
  labels: StartLabels,
  budgetSeconds: number,
): string {
  const prefix = `Foreground wait reached the prompt-cache-safe budget (${budgetSeconds}s) for task ${started.task_id}; the task continues in background. Completion will arrive as a notification; steer with task_send, read with task_output.`
  return `${prefix}\n\n${backgroundStartText(started, labels)}`
}
