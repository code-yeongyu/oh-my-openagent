import type { AgentToolResult } from "@code-yeongyu/senpi"

import type { PlanResolutionError, StartResult, TaskManager } from "../../manager"
import type { TaskRecord } from "../../state"
import type { ForegroundWaitOptions, ForegroundWaitResult } from "./foreground-wait"
import { waitForForegroundTask } from "./foreground-wait"
import { MAX_TASK_BATCH_ITEMS } from "./params"
import { backgroundConversionText } from "./start-presentation"
import type { ResolvedSpawnItem, TaskToolContext, TaskToolDetails, TaskToolItemDetail } from "./types"

type StartedResult = Extract<StartResult, { kind: "started" }>
type FailedStartResult = Exclude<StartResult, StartedResult>

type BatchStart =
  | { readonly kind: "started"; readonly item: ResolvedSpawnItem; readonly result: StartedResult }
  | { readonly kind: "failed"; readonly item: ResolvedSpawnItem; readonly detail: TaskToolItemDetail }

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
  readonly startItem: (item: ResolvedSpawnItem) => Promise<StartResult>
}

function result(text: string, details: TaskToolDetails): AgentToolResult<TaskToolDetails> {
  return { content: [{ type: "text", text }], details }
}

function continuationFooter(taskId: string): string {
  return `\n\n[task_id: ${taskId} - continue with task_send(to="${taskId}", message="...")]`
}

function failedStartDetail(item: ResolvedSpawnItem, start: FailedStartResult): TaskToolItemDetail {
  switch (start.kind) {
    case "plan_unresolved": {
      return itemError(item, "", start.error.message + categoryListSuffix(start.error))
    }
    case "depth_denied":
      return itemError(item, "", start.reason)
    case "start_failed":
      return { task_id: start.task_id, name: start.name, status: "error", error_message: start.error_message }
    case "residency_denied":
      return itemError(item, "", start.reason)
  }
}

function itemError(item: ResolvedSpawnItem, taskId: string, message: string): TaskToolItemDetail {
  return {
    task_id: taskId,
    ...(item.name !== undefined && { name: item.name }),
    status: "error",
    error_message: message,
  }
}

function startedDetail(item: ResolvedSpawnItem, start: StartedResult): TaskToolItemDetail {
  return {
    task_id: start.task_id,
    name: start.name,
    ...(item.task_summary === undefined ? {} : { task_summary: item.task_summary }),
    ...(item.kind === "category" ? { category: item.category } : { subagent_type: item.subagentType }),
    ...(item.model === undefined ? {} : { model: item.model }),
    ...(start.resolved_model === undefined ? {} : { resolved_model: start.resolved_model }),
    status: start.status,
    ...(start.queue_position !== undefined && { queue_position: start.queue_position }),
  }
}

async function startAll(input: ExecuteBatchInput): Promise<readonly BatchStart[]> {
  const starts: BatchStart[] = []
  for (const item of input.items) {
    try {
      const start = await input.startItem(item)
      starts.push(
        start.kind === "started"
          ? { kind: "started", item, result: start }
          : { kind: "failed", item, detail: failedStartDetail(item, start) },
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      starts.push({ kind: "failed", item, detail: itemError(item, "", message) })
    }
  }
  return starts
}

function categoryListSuffix(error: PlanResolutionError): string {
  const available = error.availableCategories
  if (available === undefined || available.length === 0) return ""
  // A model_unavailable failure means the category name IS valid; listing it under "Available
  // categories" told models to retry the same broken binding. Name the vocabulary honestly and
  // point at the omo.json config escape hatch.
  if (error.code === "model_unavailable") {
    return ` Valid category names: ${available.join(", ")}. Retry one of these, or configure categories.<name>.models in omo.json — model overrides cannot be combined with category.`
  }
  return ` Available categories: ${available.join(", ")}.`
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
  const live = starts.filter((start): start is Extract<BatchStart, { kind: "started" }> => start.kind === "started")
  const status = live.length > 0 ? "running" : "error"
  const taskId = live[0]?.result.task_id ?? ""
  const items = starts.map((start) => start.kind === "started" ? startedDetail(start.item, start.result) : start.detail)
  return result(backgroundText(starts, status), {
    task_id: taskId,
    status,
    mode: "spawn",
    run_in_background: true,
    items,
  })
}

function recordOutput(record: TaskRecord, start: StartedResult): BatchItemOutput {
  return {
    detail: {
      task_id: record.task_id,
      name: record.name ?? start.name,
      status: record.status,
      ...(record.error_message !== undefined && { error_message: record.error_message }),
    },
    body: record.final_response ?? record.error_message ?? `Task ${record.status}`,
    continuation: true,
  }
}

function promotedOutput(start: Extract<BatchStart, { kind: "started" }>, budgetSeconds: number): BatchItemOutput {
  return {
    detail: {
      ...startedDetail(start.item, start.result),
      run_in_background: true,
    },
    body: backgroundConversionText(start.result, { taskSummary: start.item.task_summary, description: start.item.description }, budgetSeconds),
    continuation: false,
  }
}

function rejectionMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function rejectedOutput(start: StartedResult, aborted: boolean, reason: unknown): BatchItemOutput {
  const message = aborted ? "parent turn aborted" : rejectionMessage(reason)
  return {
    detail: { task_id: start.task_id, name: start.name, status: aborted ? "cancelled" : "error", error_message: message },
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

async function syncResult(input: ExecuteBatchInput, starts: readonly BatchStart[]): Promise<AgentToolResult<TaskToolDetails>> {
  const live = starts.filter((start): start is Extract<BatchStart, { kind: "started" }> => start.kind === "started")
  const settled = await Promise.allSettled(live.map((start) => waitForForegroundTask({
    manager: input.manager,
    taskId: start.result.task_id,
    signal: input.signal,
    ctx: input.ctx,
    ...(input.env !== undefined && { env: input.env }),
    ...(input.scheduleDeadline !== undefined && { scheduleDeadline: input.scheduleDeadline }),
  })))
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
    if (entry === undefined) return rejectedOutput(start.result, false, "missing wait result")
    if (entry.status === "fulfilled") {
      const waited: ForegroundWaitResult = entry.value
      return waited.kind === "completed"
        ? recordOutput(waited.record, start.result)
        : promotedOutput(start, waited.budgetSeconds)
    }
    const aborted = input.signal?.aborted === true && entry.reason === input.signal.reason
    return rejectedOutput(start.result, aborted, entry.reason)
  })
  const items = outputs.map((output) => output.detail)
  const status = aggregateStatus(items, batchAborted)
  const taskId = live[0]?.result.task_id ?? ""
  const runInBackground = items.some((item) => item.run_in_background === true)
  return result(syncText(status, outputs), {
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
