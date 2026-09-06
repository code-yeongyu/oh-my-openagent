import type { EntryRenderer } from "@code-yeongyu/senpi"
import { containsSecretLikeMaterial, isValidHint, NUDGE_HINT_MAX_CHARS } from "@oh-my-opencode/memory-core"

import { joinFields, noticeComponent, normalizeRendererText } from "./worker/entry-renderers"

export const NUDGED_ENTRY_TYPE = "omo-memorian:nudged"
export const GATE_ENTRY_TYPE = "omo-memorian:gate"
export const GATE_REASON_MAX_CHARS = 160

export interface MemorianNudgedRecord {
  readonly version: 1
  readonly nudges: readonly { readonly path: string; readonly hint: string }[]
}

export interface MemorianGateRecord {
  readonly version: 1
  readonly status: "skipped" | "failed" | "dropped"
  readonly cause?: string
  readonly model?: string
  readonly candidateCount: number
  readonly reason?: string
  readonly runId?: string
}

// Both renderers are fail-closed: a record that does not match the producer contract draws
// nothing rather than a half-formed notice. The session file is user-writable and older or
// foreign producers may append entries under these types, so shape is re-validated here even
// though the producer already validated it.
export const renderMemorianNudgedEntry: EntryRenderer<MemorianNudgedRecord> = (entry, options, theme) => {
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
  return noticeComponent({
    glyph: "·",
    title: joinFields(["Memorian nudged", first.hint]),
    tone: "muted",
    why: "Memorian judged a stored memory relevant to the previous turn; it is a hint, not current state.",
    extra: [
      ...rest.map((nudge) => ({ text: nudge.hint, tone: "dim" as const })),
      ...nudges.map((nudge) => ({ text: nudge.path, tone: "dim" as const })),
    ],
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

export const renderMemorianGateEntry: EntryRenderer<MemorianGateRecord> = (entry, options, theme) => {
  const record: unknown = entry.data
  if (!isRecord(record) || record.version !== 1) return undefined
  const candidateCount = record.candidateCount
  if (typeof candidateCount !== "number" || !Number.isInteger(candidateCount) || candidateCount < 0) return undefined
  if (record.status === "dropped") return undefined
  if (record.status !== "skipped" && record.status !== "failed") return undefined
  const cause = typeof record.cause === "string" ? normalizeRendererText(record.cause) : undefined
  const reason = validGateReason(record.reason)
  const runId = validRunId(record.runId)
  const extra = [
    ...(reason === undefined ? [] : [{ text: reason, tone: "dim" as const }]),
    ...(runId === undefined ? [] : [{ text: `run ${runId}`, tone: "dim" as const }]),
  ]
  return noticeComponent({
    glyph: record.status === "skipped" ? "⚠" : "✗",
    title: joinFields([`Memorian gate ${record.status === "skipped" ? "skipped" : "failed"}`, cause]),
    tone: record.status === "skipped" ? "warning" : "error",
    why: record.status === "skipped"
      ? "Memorian could not judge the stored memories for the previous turn."
      : "Memorian failed while judging the stored memories for the previous turn.",
    ...(extra.length === 0 ? {} : { extra }),
  }, options, theme)
}
