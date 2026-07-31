import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { messageability } from "../state"
import type { TaskRecord } from "../state"
import {
  excerptRendererPromptText,
  joinRendererTokens,
  normalizeRendererText,
  rendererVisibleWidth,
} from "../tools/task/renderers"
import type { CompletionDetails, ParentNotifierMessage } from "./types"

export const FINAL_RESPONSE_TRANSPORT_LIMIT = 32_000

export type BuildDetailsOptions = {
  readonly tokens?: number
  readonly stateDir?: string
}

export function buildCompletionDetails(record: TaskRecord, options: BuildDetailsOptions = {}): CompletionDetails {
  const finalResponse = finalResponseForNotification(record, options.stateDir)
  const runStats = record.run_stats
  const tokens = options.tokens ?? runStats?.total_tokens
  const base: CompletionDetails = {
    task_id: record.task_id,
    name: record.name ?? record.task_id,
    status: record.status,
    ...(record.category === undefined ? {} : { category: record.category }),
    ...(record.agent_type === undefined ? {} : { agent_type: record.agent_type }),
    model: record.model,
    ...(record.requested_model === undefined
      ? {}
      : { requested_model: record.requested_model }),
    ...(record.fallback_models === undefined
      ? {}
      : { fallback_models: record.fallback_models }),
    ...(record.resolved_model === undefined ? {} : { resolved_model: record.resolved_model }),
    duration_ms: durationMs(record),
    ...(runStats === undefined ? {} : { run_stats: runStats }),
    final_response: finalResponse.text,
    ...(finalResponse.file === undefined ? {} : { final_response_file: finalResponse.file }),
    continuation_hint: continuationHint(record),
  }
  return tokens === undefined ? base : { ...base, tokens }
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

function finalResponseForNotification(record: TaskRecord, stateDir: string | undefined): { readonly text: string; readonly file?: string } {
  const source = record.final_response ?? record.error_message ?? ""
  if (source.length <= FINAL_RESPONSE_TRANSPORT_LIMIT) return { text: source }
  if (stateDir === undefined) return { text: source.slice(0, FINAL_RESPONSE_TRANSPORT_LIMIT) }

  const path = completionSpillPath(stateDir, record.task_id)
  mkdirSync(join(stateDir, "completion-results"), { recursive: true })
  writeFileSync(path, source, "utf8")
  return { text: source.slice(0, FINAL_RESPONSE_TRANSPORT_LIMIT), file: `local://${path}` }
}

function completionSpillPath(stateDir: string, taskId: string): string {
  return join(stateDir, "completion-results", `${taskId}.txt`)
}

function durationMs(record: TaskRecord): number {
  const started = Date.parse(record.created_at)
  const ended = Date.parse(record.updated_at)
  if (Number.isNaN(started) || Number.isNaN(ended)) return 0
  return Math.max(0, ended - started)
}

function continuationHint(record: TaskRecord): string {
  const mode = messageability(record.status, record.residency_state)
  if (mode === "not-continuable") return ""
  return `Use task_send({ to: "${record.task_id}", message: "..." }) to continue.`
}

function completionDetailLines(detail: CompletionDetails, width: number | undefined): readonly string[] {
  const summary = joinRendererTokens([
    "task completion",
    `name:${normalizeRendererText(detail.name)}`,
    `id:${normalizeRendererText(detail.task_id)}`,
    detail.category === undefined ? undefined : `category:${normalizeRendererText(detail.category)}`,
    detail.agent_type === undefined ? undefined : `agent:${normalizeRendererText(detail.agent_type)}`,
    `model:${normalizeRendererText(detail.resolved_model?.display ?? detail.model)}`,
    fallbackToken(detail),
    `status:${normalizeRendererText(detail.status)}`,
    `duration:${formatDuration(detail.duration_ms)}`,
    detail.tokens === undefined ? undefined : `tokens:${detail.tokens}`,
    detail.run_stats?.tool_calls === undefined ? undefined : `tools:${detail.run_stats.tool_calls}`,
    detail.run_stats?.tokens_per_second === undefined ? undefined : `tps:${detail.run_stats.tokens_per_second}`,
  ])
  const response = width === undefined ? detail.final_response : normalizeRendererText(detail.final_response)
  const continuation = width === undefined ? detail.continuation_hint : normalizeRendererText(detail.continuation_hint)
  const resultPrefix = 'result:"'
  const resultFilePrefix = "result_file:"
  const nextPrefix = "next:"
  return [
    width === undefined ? summary : excerptRendererPromptText(summary, width),
    ...(response.length === 0
      ? []
      : [`${resultPrefix}${excerptForWidth(response, width, resultPrefix, '"')}"`]),
    ...(detail.final_response_file === undefined
      ? []
      : [`${resultFilePrefix}${excerptForWidth(detail.final_response_file, width, resultFilePrefix, "")}`]),
    ...(continuation.length === 0
      ? []
      : [`${nextPrefix}${excerptForWidth(continuation, width, nextPrefix, "")}`]),
  ]
}

function fallbackToken(detail: CompletionDetails): string | undefined {
  const requested = detail.requested_model?.display
  const resolved = detail.resolved_model?.display ?? detail.model
  if (requested === undefined || requested === resolved) return undefined
  return `fallback:${normalizeRendererText(requested)}->${normalizeRendererText(resolved)}`
}

function excerptForWidth(value: string, width: number | undefined, prefix: string, suffix: string): string {
  if (width === undefined) return value
  return excerptRendererPromptText(value, availableExcerptWidth(width, prefix, suffix))
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
