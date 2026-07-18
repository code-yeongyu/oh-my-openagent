import { messageability } from "../state"
import type { TaskRecord } from "../state"
import {
  excerptRendererPromptText,
  joinRendererTokens,
  normalizeRendererText,
  rendererVisibleWidth,
} from "../tools/task/renderers"
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
    content: completionMessageLines(details).join("\n"),
    display: false,
    details,
  }
}

export function completionMessageLines(details: readonly CompletionDetails[], width?: number): readonly string[] {
  return details.flatMap((detail) => completionDetailLines(detail, width))
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
  return `Use task_send({ to: "${record.task_id}", message: "..." }) to continue, or ${output}.`
}

function completionDetailLines(detail: CompletionDetails, width: number | undefined): readonly string[] {
  const summary = joinRendererTokens([
    "task completion",
    `name:${normalizeRendererText(detail.name)}`,
    `id:${normalizeRendererText(detail.task_id)}`,
    `status:${normalizeRendererText(detail.status)}`,
    `duration:${formatDuration(detail.duration_ms)}`,
    detail.tokens === undefined ? undefined : `tokens:${detail.tokens}`,
  ])
  const head = normalizeRendererText(detail.final_response_head)
  const continuation = normalizeRendererText(detail.continuation_hint)
  const resultPrefix = 'result:"'
  const nextPrefix = "next:"
  return [
    width === undefined ? summary : excerptRendererPromptText(summary, width),
    ...(head.length === 0
      ? []
      : [`${resultPrefix}${excerptRendererPromptText(head, availableExcerptWidth(width, resultPrefix, '"'))}"`]),
    ...(continuation.length === 0
      ? []
      : [`${nextPrefix}${excerptRendererPromptText(continuation, availableExcerptWidth(width, nextPrefix, ""))}`]),
  ]
}

function availableExcerptWidth(width: number | undefined, prefix: string, suffix: string): number | undefined {
  if (width === undefined) return undefined
  return Math.max(0, width - rendererVisibleWidth(prefix) - rendererVisibleWidth(suffix))
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${durationMs}ms`
  const seconds = (durationMs / 1_000).toFixed(2).replace(/\.00$/u, "").replace(/(\.\d)0$/u, "$1")
  return `${seconds}s`
}
