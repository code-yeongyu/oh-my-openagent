import type { EntryRenderer } from "@code-yeongyu/senpi"
import { containsSecretLikeMaterial, isValidHint, NUDGE_HINT_MAX_CHARS } from "@oh-my-opencode/memory-core"

import { joinFields, noticeComponent, normalizeRendererText } from "../worker/entry-renderers"

export const NUDGED_ENTRY_TYPE = "omo-kibitzer:nudged"
export const GATE_ENTRY_TYPE = "omo-kibitzer:gate"
export const GATE_REASON_MAX_CHARS = 160

export interface KibitzerNudgedRecord {
  readonly version: 1
  readonly nudges: readonly { readonly path: string; readonly hint: string }[]
  readonly via?: "steer" | "wake" | "prompt"
}

export interface KibitzerGateRecord {
  readonly version: 1
  readonly status: "skipped" | "failed" | "dropped"
  readonly cause?: string
  readonly model?: string
  readonly candidateCount: number
  readonly reason?: string
  /** One-shot era: the judge run that failed. Resident records carry `wake` instead. */
  readonly runId?: string
  readonly consecutiveFailures?: number
  /** Resident era (additive): the sidecar wake number whose failure completed the streak. */
  readonly wake?: number
}

// Both renderers are fail-closed: a record that does not match the producer contract draws
// nothing rather than a half-formed notice. The session file is user-writable and older or
// foreign producers may append entries under these types, so shape is re-validated here even
// though the producer already validated it.
export const renderKibitzerNudgedEntry: EntryRenderer<unknown> = (entry, options, theme) => {
  const record = entry.data
  if (!isRecord(record) || record.version !== 1 || !Array.isArray(record.nudges) || record.nudges.length === 0) return undefined
  const nudges: Array<{ readonly path: string; readonly hint: string }> = []
  for (const nudge of record.nudges) {
    const normalized = normalizeNudge(nudge)
    if (normalized === undefined) return undefined
    nudges.push(normalized)
  }
  const [first, ...rest] = nudges
  if (first === undefined) return undefined
  // Kibitzer owns the advice. Stored opener fields and delivery provenance do not
  // change its title, including when replaying older sessions.
  return noticeComponent({
    glyph: "✦",
    title: "Kibitzer !",
    tone: "accent",
    why: `recalled memory: ${first.hint}`,
    extra: [
      ...rest.map((nudge) => ({ text: `recalled memory: ${nudge.hint}`, tone: "dim" as const })),
      ...nudges.map((nudge) => ({ text: nudge.path, tone: "dim" as const })),
    ],
    detail: "Kibitzer surfaced this from stored memory; it is a hint, not current state.",
  }, options, theme)
}

/**
 * A nudge is renderable only when both fields survive normalization (control sequences and
 * surrounding whitespace stripped) and the hint respects the gate's own budget
 * (`NUDGE_HINT_MAX_CHARS`), which is the contract the producer validated against.
 */
function normalizeNudge(value: unknown): { readonly path: string; readonly hint: string } | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.path !== "string" || typeof value.hint !== "string") return undefined
  if (value.hint.length > NUDGE_HINT_MAX_CHARS || !isValidHint(value.hint)) return undefined
  const path = normalizeRendererText(value.path)
  const hint = normalizeRendererText(value.hint)
  if (path.length === 0 || hint.length === 0) return undefined
  return { path, hint }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function validGateReason(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const normalized = normalizeRendererText(value)
  if (normalized.length === 0 || normalized.length > GATE_REASON_MAX_CHARS || containsSecretLikeMaterial(value)) return undefined
  if (/[\r\n]/u.test(value)) return undefined
  return normalized
}

function validRunId(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9-]{1,64}$/.test(value) ? value : undefined
}

export const renderKibitzerGateEntry: EntryRenderer<KibitzerGateRecord> = (entry, options, theme) => {
  const record: unknown = entry.data
  if (!isRecord(record) || record.version !== 1) return undefined
  const candidateCount = record.candidateCount
  if (typeof candidateCount !== "number" || !Number.isInteger(candidateCount) || candidateCount < 0) return undefined
  if (record.status === "dropped") return undefined
  if (record.status !== "skipped" && record.status !== "failed") return undefined
  if (typeof record.consecutiveFailures !== "number"
    || !Number.isInteger(record.consecutiveFailures)
    || record.consecutiveFailures < 1) return undefined
  const cause = typeof record.cause === "string" ? normalizeRendererText(record.cause) : undefined
  const reason = validGateReason(record.reason)
  const runId = validRunId(record.runId)
  const consecutiveFailures = record.consecutiveFailures
  const extra = [
    ...(reason === undefined ? [] : [{ text: reason, tone: "dim" as const }]),
    ...(runId === undefined ? [] : [{ text: `run ${runId}`, tone: "dim" as const }]),
    { text: `after ${consecutiveFailures} consecutive failures; check Kibitzer model/provider settings`, tone: "dim" as const },
  ]
  return noticeComponent({
    glyph: record.status === "skipped" ? "⚠" : "✗",
    title: joinFields([`Kibitzer gate ${record.status === "skipped" ? "skipped" : "failed"}`, cause]),
    tone: record.status === "skipped" ? "warning" : "error",
    why: record.status === "skipped"
      ? "Kibitzer could not judge the recalled memory candidates for the previous turn."
      : "Kibitzer failed while judging the recalled memory candidates for the previous turn.",
    ...(extra.length === 0 ? {} : { extra }),
  }, options, theme)
}
