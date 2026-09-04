import type { AgentToolResult, AgentToolUpdateCallback } from "@code-yeongyu/senpi"

import type { StartResult, TaskManager } from "../../manager"
import type { TaskRecord } from "../../state"
import { failedStartDetail, itemError, startedDetail, type StartedResult } from "./batch-item-details"
import { trackBatchProgress } from "./batch-progress"
import type { ForegroundWaitOptions, ForegroundWaitResult } from "./foreground-wait"
import { waitForForegroundTask } from "./foreground-wait"
import { MAX_TASK_BATCH_ITEMS } from "./params"
import { appendMissingSkills } from "./skill-result"
import { backgroundConversionText } from "./start-presentation"
import type { ResolvedSpawnItem, TaskSkillSummary, TaskToolContext, TaskToolDetails, TaskToolItemDetail } from "./types"

type BatchStart =
  | { readonly kind: "started"; readonly item: ResolvedSpawnItem; readonly result: StartedResult; readonly skills?: TaskSkillSummary }
  | { readonly kind: "failed"; readonly item: ResolvedSpawnItem; readonly detail: TaskToolItemDetail; readonly skills?: TaskSkillSummary }

type LiveStart = Extract<BatchStart, { kind: "started" }>

type BatchItemOutput = {
  readonly detail: TaskToolItemDetail
  readonly body: string
  readonly continuation: boolean
}

export type ExecuteBatchInput = ForegroundWaitOptions & {
  readonly manager: TaskManager
  readonly items: readonly ResolvedSpawnItem[]
  readonly signal: AbortSignal | undefined
  readonly ctx: TaskToolContext
  readonly runInBackground: boolean
  readonly onUpdate?: AgentToolUpdateCallback<TaskToolDetails>
  readonly startItem: (item: ResolvedSpawnItem) => Promise<StartResult>
  readonly skillSummaryFor?: (item: ResolvedSpawnItem) => TaskSkillSummary | undefined
}

function result(text: string, details: TaskToolDetails): AgentToolResult<TaskToolDetails> {
  return { content: [{ type: "text", text }], details }
}

function continuationFooter(taskId: string): string {
  return `\n\n[task_id: ${taskId} - continue with task_send(to="${taskId}", message="...")]`
}

async function startAll(input: ExecuteBatchInput): Promise<readonly BatchStart[]> {
  const starts: BatchStart[] = []
  for (const item of input.items) {
    try {
      const start = await input.startItem(item)
      const skills = input.skillSummaryFor?.(item)
      starts.push(
        start.kind === "started"
          ? { kind: "started", item, result: start, ...(skills === undefined ? {} : { skills }) }
          : { kind: "failed", item, detail: failedStartDetail(item, start, skills), ...(skills === undefined ? {} : { skills }) },
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      starts.push({ kind: "failed", item, detail: itemError(item, "", message) })
    }
  }
  return starts
}

function oversizedBatchResult(): AgentToolResult<TaskToolDetails> {
  const reason = `tasks supports at most ${MAX_TASK_BATCH_ITEMS} items.`
  return result(reason, { task_id: "", status: "invalid_arguments", mode: "spawn", reason })
}

function backgroundText(starts: readonly BatchStart[], status: "running" | "error"): string {
  const lines = starts.map((start, index) => {
    if (start.kind === "failed") {
      return `${index + 1}. ${start.detail.name ?? "task"} (error): ${start.detail.error_message ?? "start failed"}`
    }
    const queue = start.result.queue_position === undefined ? "" : ` queue:${start.result.queue_position}`
    return `${index + 1}. ${start.result.name} ${start.result.task_id} (${start.result.status})${queue}${continuationFooter(start.result.task_id)}`
  })
  return [`Batch ${status}.`, ...lines].join("\n")
}

function backgroundResult(starts: readonly BatchStart[]): AgentToolResult<TaskToolDetails> {
  const live = starts.filter((start): start is LiveStart => start.kind === "started")
  const status = live.length > 0 ? "running" : "error"
  const taskId = live[0]?.result.task_id ?? ""
  const items = starts.map((start) => start.kind === "started" ? startedDetail(start.item, start.result, start.skills) : start.detail)
  return result(appendMissingSkills(backgroundText(starts, status), starts.map((start) => start.skills)), {
    task_id: taskId,
    status,
    mode: "spawn",
    run_in_background: true,
    items,
  })
}

function recordOutput(record: TaskRecord, start: StartedResult, skills?: TaskSkillSummary): BatchItemOutput {
  return {
    detail: {
      task_id: record.task_id,
      name: record.name ?? start.name,
      status: record.status,
      ...(record.error_message !== undefined && { error_message: record.error_message }),
      ...(skills === undefined ? {} : { skills }),
    },
    body: record.final_response ?? record.error_message ?? `Task ${record.status}`,
    continuation: true,
  }
}

function promotedOutput(start: LiveStart, budgetSeconds: number): BatchItemOutput {
  return {
    detail: {
      ...startedDetail(start.item, start.result, start.skills),
      run_in_background: true,
    },
    body: backgroundConversionText(start.result, { taskSummary: start.item.task_summary, description: start.item.description }, budgetSeconds),
    continuation: false,
  }
}

function rejectionMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function rejectedOutput(start: LiveStart, aborted: boolean, reason: unknown): BatchItemOutput {
  const message = aborted ? "parent turn aborted" : rejectionMessage(reason)
  return {
    detail: {
      task_id: start.result.task_id,
      name: start.result.name,
      status: aborted ? "cancelled" : "error",
      error_message: message,
      ...(start.skills === undefined ? {} : { skills: start.skills }),
    },
    body: message,
    continuation: true,
  }
}

function aggregateStatus(items: readonly TaskToolItemDetail[], aborted: boolean): "running" | "error" | "cancelled" | "completed" {
  if (items.some((item) => item.status === "running" || item.status === "pending")) return "running"
  if (items.some((item) => item.status === "error" || item.status === "lost")) return "error"
  if (aborted || items.some((item) => item.status === "cancelled" || item.status === "interrupted")) return "cancelled"
  return "completed"
}

function syncText(status: "running" | "error" | "cancelled" | "completed", outputs: readonly BatchItemOutput[]): string {
  const lines = outputs.map((output, index) => {
    const label = output.detail.name ?? (output.detail.task_id || "task")
    const footer = output.continuation ? continuationFooter(output.detail.task_id) : ""
    return `${index + 1}. ${label} (${output.detail.status}): ${output.body}${footer}`
  })
  return [`Batch ${status}.`, ...lines].join("\n")
}

function settledStatus(waited: ForegroundWaitResult): string {
  return waited.kind === "completed" ? waited.record.status : "background"
}

async function waitForAll(input: ExecuteBatchInput, live: readonly LiveStart[]): Promise<readonly PromiseSettledResult<ForegroundWaitResult>[]> {
  const progress = trackBatchProgress({ manager: input.manager, live, onUpdate: input.onUpdate })
  try {
    return await Promise.allSettled(live.map((start) => waitForForegroundTask({
      manager: input.manager,
      taskId: start.result.task_id,
      signal: input.signal,
      ctx: input.ctx,
      ...(input.env !== undefined && { env: input.env }),
      ...(input.scheduleDeadline !== undefined && { scheduleDeadline: input.scheduleDeadline }),
    }).then(
      (waited) => {
        progress.settle(start.result.task_id, settledStatus(waited))
        return waited
      },
      (reason: unknown) => {
        progress.settle(start.result.task_id, "error")
        throw reason
      },
    )))
  } finally {
    progress.stop()
  }
}

async function syncResult(input: ExecuteBatchInput, starts: readonly BatchStart[]): Promise<AgentToolResult<TaskToolDetails>> {
  const live = starts.filter((start): start is LiveStart => start.kind === "started")
  const settled = await waitForAll(input, live)
  const batchAborted = settled.some(
    (entry) => entry.status === "rejected" && input.signal?.aborted === true && entry.reason === input.signal.reason,
  )
  const unsettledIndexes = batchAborted
    ? settled.flatMap((entry, index) => entry.status === "rejected" ? [index] : [])
    : []
  await Promise.allSettled(unsettledIndexes.map((index) => {
    const start = live[index]
    return start === undefined ? Promise.resolve() : input.manager.cancelTask(start.result.task_id, "parent turn aborted")
  }))

  let liveIndex = 0
  const outputs = starts.map((start): BatchItemOutput => {
    if (start.kind === "failed") {
      return { detail: start.detail, body: start.detail.error_message ?? "start failed", continuation: false }
    }
    const entry = settled[liveIndex]
    liveIndex += 1
    if (entry === undefined) return rejectedOutput(start, false, "missing wait result")
    if (entry.status === "fulfilled") {
      const waited: ForegroundWaitResult = entry.value
      return waited.kind === "completed"
        ? recordOutput(waited.record, start.result, start.skills)
        : promotedOutput(start, waited.budgetSeconds)
    }
    const aborted = input.signal?.aborted === true && entry.reason === input.signal.reason
    return rejectedOutput(start, aborted, entry.reason)
  })
  const items = outputs.map((output) => output.detail)
  const status = aggregateStatus(items, batchAborted)
  const taskId = live[0]?.result.task_id ?? ""
  const runInBackground = items.some((item) => item.run_in_background === true)
  return result(appendMissingSkills(syncText(status, outputs), starts.map((start) => start.skills)), {
    task_id: taskId,
    status,
    mode: "spawn",
    run_in_background: runInBackground,
    items,
  })
}

export async function executeBatch(input: ExecuteBatchInput): Promise<AgentToolResult<TaskToolDetails>> {
  if (input.signal?.aborted === true) {
    const reason = "Parent aborted before spawn"
    return result(reason, { task_id: "", status: "cancelled", mode: "spawn", reason })
  }
  if (input.items.length > MAX_TASK_BATCH_ITEMS) return oversizedBatchResult()
  const starts = await startAll(input)
  return input.runInBackground ? backgroundResult(starts) : syncResult(input, starts)
}
