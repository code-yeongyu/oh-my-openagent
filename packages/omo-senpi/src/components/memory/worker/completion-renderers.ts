import type { EntryRenderer } from "@code-yeongyu/senpi"
import type { ReflectionTrigger } from "@oh-my-opencode/memory-core"
import { normalizeRendererText } from "@oh-my-opencode/senpi-task/renderer-text"

import {
  REFLECTION_COMPLETION_ENTRY_TYPE,
  REFLECTION_LAUNCHED_ENTRY_TYPE,
  REFLECTION_SUMMARY_ENTRY_TYPE,
  type ReflectionCompletionApi,
  type ReflectionCompletionRecord,
  type ReflectionCompletionSummary,
  type ReflectionLaunchedEntry,
} from "./completion-contracts"
import { reflectionRemediation } from "./remediation"
import {
  detailExcerpt,
  joinFields,
  noticeComponent,
  optionalRendererText,
  outcomeGlyph,
  outcomeLabel,
  outcomeSummary,
  outcomeThemeColor,
  runLabel,
} from "./entry-renderers"

/** Plain-text launch line, kept for notify/log surfaces that cannot carry colour. */
export function reflectionLaunchedText(launched: ReflectionLaunchedEntry): string {
  return `memory reflection started run:${normalizeRendererText(launched.runId)} trigger:${normalizeRendererText(launched.trigger)} (+${launched.backlogSteps} steps)`
}

// In-flight work reads as `accent`, matching the running state in statusThemeColor.
export const renderReflectionLaunchedEntry: EntryRenderer<ReflectionLaunchedEntry> = (entry, options, theme) => {
  const launched = entry.data
  if (launched === undefined) return undefined
  const conversations = launched.conversationIds.length
  const model = optionalRendererText(launched.model)
  const thinking = optionalRendererText(launched.thinking)
  return noticeComponent(
    {
      glyph: "◐",
      title: joinFields(["Memory reflection started", runLabel(launched.runId)]),
      tone: "accent",
      why: `The outcome lands in this transcript when the run settles - ${triggerPhrase(launched.trigger)} after ${launched.backlogSteps} new step${launched.backlogSteps === 1 ? "" : "s"}.`,
      extra: [
        {
          text: joinFields([
            `${conversations} conversation${conversations === 1 ? "" : "s"}`,
            `category ${normalizeRendererText(launched.category)}`,
            model === undefined ? undefined : `model ${model}`,
            thinking === undefined ? undefined : `thinking ${thinking}`,
          ]),
          tone: "dim",
        },
      ],
      detail: joinFields([
        `trigger ${normalizeRendererText(launched.trigger)}`,
        `identity ${normalizeRendererText(launched.identity)}`,
        `started ${normalizeRendererText(launched.startedAt)}`,
      ]),
    },
    options,
    theme,
  )
}

function triggerPhrase(trigger: ReflectionTrigger): string {
  return trigger === "manual" ? "triggered manually" : `triggered by ${normalizeRendererText(trigger)}`
}

export const renderReflectionCompletionEntry: EntryRenderer<ReflectionCompletionRecord> = (entry, options, theme) => {
  const record = entry.data
  if (!record) return undefined
  const reason = optionalRendererText(record.reason)
  const detail = optionalRendererText(record.detail)
  const model = optionalRendererText(record.model)
  const thinking = optionalRendererText(record.thinking)
  const budgetRemediation = record.reason === "budget_not_met"
    ? reflectionRemediation(record.reason, record.detail)
    : undefined
  const payoff = joinFields([
    record.filesChanged !== undefined && record.filesChanged > 0
      ? `${record.filesChanged} file${record.filesChanged === 1 ? "" : "s"} changed`
      : undefined,
    record.mergedCommitSha === undefined ? undefined : `commit ${normalizeRendererText(record.mergedCommitSha).slice(0, 7)}`,
    record.durationMs === undefined ? undefined : `took ${formatDuration(record.durationMs)}`,
    reason === undefined ? undefined : `reason ${reason}`,
    detail === undefined ? undefined : detailExcerpt(detail),
    budgetRemediation,
  ])
  return noticeComponent(
    {
      glyph: outcomeGlyph(record.outcome),
      title: joinFields([`Memory reflection ${outcomeLabel(record.outcome)}`, runLabel(record.runId)]),
      tone: outcomeThemeColor(record.outcome),
      why: outcomeSummary(record.outcome),
      extra: payoff.length === 0 ? [] : [{ text: payoff, tone: outcomeThemeColor(record.outcome) }],
      detail: joinFields([
        `category ${normalizeRendererText(record.category)}`,
        `identity ${normalizeRendererText(record.identity)}`,
        `trigger ${normalizeRendererText(record.trigger)}`,
        model === undefined ? undefined : `model ${model}`,
        thinking === undefined ? undefined : `thinking ${thinking}`,
      ]),
    },
    options,
    theme,
  )
}

export const renderReflectionSummaryEntry: EntryRenderer<ReflectionCompletionSummary> = (entry, options, theme) => {
  const summary = entry.data
  if (!summary) return undefined
  const clean = summary.failedCount === 0
  const noun = `completion${summary.count === 1 ? "" : "s"}`
  const fingerprint = optionalRendererText(summary.dominantFingerprint)
  return noticeComponent(
    {
      glyph: clean ? "●" : "⚠",
      title: `Memory reflection · ${summary.count} older ${noun} collapsed`,
      tone: clean ? "muted" : "warning",
      why: clean
        ? "Delivered while this session was away; none need attention."
        : `Delivered while this session was away; ${summary.failedCount} need attention.`,
      extra: clean || fingerprint === undefined ? [] : [{ text: `most common ${detailExcerpt(fingerprint)}`, tone: "warning" }],
      detail: joinFields([
        optionalRendererText(summary.oldestISO) === undefined ? undefined : `oldest ${normalizeRendererText(summary.oldestISO)}`,
        optionalRendererText(summary.newestISO) === undefined ? undefined : `newest ${normalizeRendererText(summary.newestISO)}`,
      ]),
    },
    options,
    theme,
  )
}

export function registerReflectionCompletionRenderer(api: ReflectionCompletionApi): void {
  api.registerEntryRenderer(REFLECTION_COMPLETION_ENTRY_TYPE, renderReflectionCompletionEntry)
  api.registerEntryRenderer(REFLECTION_LAUNCHED_ENTRY_TYPE, renderReflectionLaunchedEntry)
  api.registerEntryRenderer(REFLECTION_SUMMARY_ENTRY_TYPE, renderReflectionSummaryEntry)
}

function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "unknown"
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`
  const seconds = durationMs / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m${String(Math.round(seconds - minutes * 60)).padStart(2, "0")}s`
}
