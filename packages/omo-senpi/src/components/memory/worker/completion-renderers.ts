import type { EntryRenderer } from "@code-yeongyu/senpi"
import { buildNoticeBox, type NoticeSpec } from "@oh-my-opencode/senpi-task/notice-box"
import { normalizeRendererText } from "@oh-my-opencode/senpi-task/renderer-text"

import { rememberedTitle, shortSha } from "../memory-notice-spec"
import {
  REFLECTION_COMPLETION_ENTRY_TYPE,
  type ReflectionCompletionApi,
  type ReflectionCompletionRecord,
} from "./completion-contracts"
import { joinFields } from "./entry-renderers"
import { sanitizeReflectionReport, type ReflectionRecap } from "./reflection-recap"

// Reflection is background housekeeping: the transcript shows it only when memory actually
// changed, as the same "Remembered" notice a memory tool write draws. Launch, no-change, per-run
// failure and collapsed-summary entries are still journaled (the data and its RPC events are
// unchanged) but have no renderer, so they never draw. Repeated failures surface through the
// health and park alerts instead.

type ReflectionCompletionEntry = ReflectionCompletionRecord & { readonly recap?: ReflectionRecap }

export const renderReflectionCompletionEntry: EntryRenderer<ReflectionCompletionEntry> = (entry, options, theme) => {
  const record = entry.data
  if (record?.outcome !== "merged") return undefined
  return buildNoticeBox(reflectionNoticeSpec(record), options, theme)
}

export function registerReflectionCompletionRenderer(api: ReflectionCompletionApi): void {
  api.registerEntryRenderer(REFLECTION_COMPLETION_ENTRY_TYPE, renderReflectionCompletionEntry)
}

function reflectionNoticeSpec(record: ReflectionCompletionEntry): NoticeSpec {
  const recap = record.recap
  const paths = (recap?.changedPaths ?? []).map((path) => normalizeRendererText(path))
  const files = recap?.filesChanged ?? record.filesChanged ?? (paths.length > 0 ? paths.length : undefined)
  const sha = shortSha(recap?.mergedCommitSha ?? record.mergedCommitSha ?? "")
  const stats = joinFields([
    files === undefined || files <= 0 ? undefined : `${files} file${files === 1 ? "" : "s"} changed`,
    sha === undefined ? undefined : `commit ${sha}`,
  ])
  const sources = (recap?.conversationIds ?? record.conversationIds).map((id) => normalizeRendererText(id))
  const detail = joinFields([...paths, sources.length === 0 ? undefined : `from ${sources.join(", ")}`])
  const report = recap?.report
  return {
    title: rememberedTitle("on reflection"),
    tone: "accent",
    why: (report?.status === "available" ? reflectionHeadline(report.text) : undefined) ?? pathsSentence(paths),
    extra: stats.length === 0 ? [] : [{ text: stats, tone: "dim" }],
    ...(detail.length === 0 ? {} : { expandedLine: detail }),
  }
}

/**
 * The report's own summary, cut to its first sentence: the reflection persona writes a numbered
 * "**Summary**:" item first, so that sentence is what the run learned. Markdown list, heading and
 * emphasis markers are dropped; a report without a summary item contributes its first prose line.
 */
export function reflectionHeadline(text: string): string | undefined {
  const lines = sanitizeReflectionReport(text).split("\n").map(stripMarkdown).filter((line) => line.length > 0)
  const summaryAt = lines.findIndex((line) => /^summary\b/iu.test(line))
  const body = summaryAt < 0
    ? lines[0]
    : lines[summaryAt]?.replace(/^summary\b\s*[:-]?\s*/iu, "") || lines[summaryAt + 1]
  if (body === undefined || body.length === 0) return undefined
  const sentence = /^(.+?[.!?])(?:\s|$)/u.exec(body)?.[1] ?? body
  return normalizeRendererText(sentence)
}

function stripMarkdown(line: string): string {
  return line.trim()
    .replace(/^#+\s*/u, "")
    .replace(/^(?:\d+[.)]|[-*+])\s+/u, "")
    .replace(/\*\*|__|`/gu, "")
    .trim()
}

function pathsSentence(paths: readonly string[]): string {
  if (paths.length === 0) return "Kept what this session taught."
  return `Updated ${paths.length} memory file${paths.length === 1 ? "" : "s"} (${paths.join(", ")}).`
}
