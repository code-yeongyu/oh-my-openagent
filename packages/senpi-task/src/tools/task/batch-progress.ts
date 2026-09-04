import type { AgentToolUpdateCallback } from "@code-yeongyu/senpi"

import type { TaskManager } from "../../manager"
import { createChildProgress, type ChildProgressTarget } from "../../progress"
import { composeStatusLine, formatStatusTarget, taskIdentityLabel } from "../../status-line"
import { startedDetail, type StartedResult } from "./batch-item-details"
import type { ResolvedSpawnItem, TaskSkillSummary, TaskToolDetails } from "./types"

const EMIT_INTERVAL_MS = 250

export type LiveBatchStart = {
  readonly item: ResolvedSpawnItem
  readonly result: StartedResult
  readonly skills?: TaskSkillSummary
}

export type BatchProgressTracker = {
  settle(taskId: string, status: string): void
  stop(): void
}

type BatchProgressInput = {
  readonly manager: TaskManager
  readonly live: readonly LiveBatchStart[]
  readonly onUpdate: AgentToolUpdateCallback<TaskToolDetails> | undefined
}

const NO_PROGRESS: BatchProgressTracker = { settle: () => {}, stop: () => {} }

// A foreground batch has no single child for senpi's own status line to follow, so the partial
// result carries one status row per child instead: live rows come from the shared child-progress
// tracker (same grammar as a single foreground spawn), settled rows name their terminal status.
export function trackBatchProgress(input: BatchProgressInput): BatchProgressTracker {
  const { onUpdate } = input
  if (onUpdate === undefined || input.live.length === 0) return NO_PROGRESS
  const startedAt = Date.now()
  const settled = new Map<string, string>()
  const rows = input.live.map((start) => ({
    start,
    progress: createChildProgress(start.result.task_id, progressTarget(start), startedAt),
  }))

  let timer: ReturnType<typeof setTimeout> | undefined
  let emittedAt = 0
  let receivedChildEvent = false
  let closed = false
  const emit = (): void => {
    if (closed) return
    emittedAt = Date.now()
    onUpdate({
      content: [{ type: "text", text: rows.map((row, index) => `${index + 1}. ${rowText(row, settled)}`).join("\n") }],
      details: {
        task_id: input.live[0]?.result.task_id ?? "",
        status: "running",
        mode: "spawn",
        run_in_background: false,
        items: input.live.map((start) => startedDetail(start.item, start.result, start.skills)),
      },
    })
  }
  const schedule = (): void => {
    if (closed) return
    if (!receivedChildEvent) {
      receivedChildEvent = true
      emit()
      return
    }
    const remaining = EMIT_INTERVAL_MS - (Date.now() - emittedAt)
    if (remaining <= 0) {
      emit()
    } else if (timer === undefined) {
      timer = setTimeout(() => {
        timer = undefined
        emit()
      }, remaining)
      timer.unref?.()
    }
  }
  const unsubscribes = rows.map((row) =>
    input.manager.subscribeChild(row.start.result.task_id, (event) => {
      if (row.progress.accept(event)) schedule()
    }),
  )
  emit()
  return {
    settle(taskId, status) {
      settled.set(taskId, status)
      schedule()
    },
    stop() {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
        emit()
      }
      closed = true
      for (const unsubscribe of unsubscribes) unsubscribe()
    },
  }
}

type ProgressRow = ReturnType<typeof createChildProgress>

function rowText(row: { readonly start: LiveBatchStart; readonly progress: ProgressRow }, settled: ReadonlyMap<string, string>): string {
  const status = settled.get(row.start.result.task_id)
  if (status !== undefined) {
    return composeStatusLine({
      identity: taskIdentityLabel({
        taskId: row.start.result.task_id,
        name: row.start.result.name,
        description: row.start.item.description,
        taskSummary: row.start.item.task_summary,
      }),
      target: formatStatusTarget(progressTarget(row.start)),
      verb: status,
    })
  }
  const details = row.progress.details()
  const last = row.progress.contentText()
  return last.length === 0 ? details.progress.activity : `${details.progress.activity}\n   ${last}`
}

function progressTarget(start: LiveBatchStart): ChildProgressTarget {
  const { item, result } = start
  return {
    ...(item.kind === "category" ? { category: item.category } : { agentType: item.subagentType }),
    ...(result.resolved_model === undefined ? {} : { resolvedModel: result.resolved_model }),
    ...(item.model === undefined ? {} : { model: item.model }),
    name: result.name,
    ...(item.task_summary === undefined ? {} : { taskSummary: item.task_summary }),
    ...(item.description === undefined ? {} : { description: item.description }),
  }
}
