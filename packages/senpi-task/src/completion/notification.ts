import { messageability } from "../state"
import type { TaskRecord } from "../state"
import type { CompletionDetails, ParentNotifierMessage } from "./types"

const FINAL_RESPONSE_HEAD_LIMIT = 700

export type BuildDetailsOptions = {
  readonly tokens?: number
}

export function buildCompletionDetails(record: TaskRecord, options: BuildDetailsOptions = {}): CompletionDetails {
  const head = responseHead(record)
  const base: CompletionDetails = {
    task_id: record.task_id,
    name: record.name ?? record.task_id,
    status: record.status,
    duration_ms: durationMs(record),
    final_response_head: head,
    continuation_hint: continuationHint(record),
  }
  return options.tokens === undefined ? base : { ...base, tokens: options.tokens }
}

export function buildCompletionMessage(details: readonly CompletionDetails[]): ParentNotifierMessage {
  return {
    customType: "senpi-task.completion",
    content: renderContent(details),
    display: false,
    details,
  }
}

function responseHead(record: TaskRecord): string {
  const source = record.final_response ?? record.error_message ?? ""
  return source.slice(0, FINAL_RESPONSE_HEAD_LIMIT)
}

function durationMs(record: TaskRecord): number {
  const started = Date.parse(record.created_at)
  const ended = Date.parse(record.updated_at)
  if (Number.isNaN(started) || Number.isNaN(ended)) return 0
  return Math.max(0, ended - started)
}

function continuationHint(record: TaskRecord): string {
  const mode = messageability(record.status, record.residency_state)
  const output = `task_output({ task_id: "${record.task_id}" }) to read the full result`
  if (mode === "not-continuable") return `Use ${output}.`
  return `Use task_send({ task_id: "${record.task_id}", prompt: "..." }) to continue, or ${output}.`
}

function renderContent(details: readonly CompletionDetails[]): string {
  const blocks = details.map(renderDetail).join("\n")
  return `<task-notification>\n${blocks}\n</task-notification>`
}

function renderDetail(detail: CompletionDetails): string {
  const tokens = detail.tokens === undefined ? "" : ` tokens=${detail.tokens}`
  return [
    `- task "${detail.name}" (${detail.task_id}) ${detail.status} in ${detail.duration_ms}ms${tokens}`,
    `  <head>${detail.final_response_head}</head>`,
    `  ${detail.continuation_hint}`,
  ].join("\n")
}
