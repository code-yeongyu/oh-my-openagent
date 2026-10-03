import type { EntryRenderer } from "@code-yeongyu/senpi"
import { containsSecretLikeMaterial, isValidHint, NUDGE_HINT_MAX_CHARS } from "@oh-my-opencode/memory-core"

import { joinFields, noticeComponent, normalizeRendererText } from "../worker/entry-renderers"

export const NUDGED_ENTRY_TYPE = "omo-kibitzer:nudged"
export const GATE_ENTRY_TYPE = "omo-kibitzer:gate"
export const UNAVAILABLE_ENTRY_TYPE = "omo-kibitzer:unavailable"
export const GATE_REASON_MAX_CHARS = 160
/** Bounds for the unavailable notice's stored fields; the renderer re-validates against them. */
export const UNAVAILABLE_CATEGORY_MAX_CHARS = 128
export const UNAVAILABLE_PROVIDER_MAX_CHARS = 64
/** Matches the producer's `WAKE_MODEL_MAX_CHARS` cap on the stored model. */
export const GATE_MODEL_MAX_CHARS = 128
/** The builtin quick chain alone lists twelve unconnected providers; every one must stay nameable. */
export const UNAVAILABLE_PROVIDER_MAX_COUNT = 16

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
  /** Resident era (additive): the `memory.recall.category` the failing model was answering for. */
  readonly category?: string
  readonly candidateCount: number
  readonly reason?: string
  /** One-shot era: the judge run that failed. Resident records carry `wake` instead. */
  readonly runId?: string
  readonly consecutiveFailures?: number
  /** Resident era (additive): the sidecar wake number whose failure completed the streak. */
  readonly wake?: number
}

/**
 * The once-per-session configuration notice: the pinned recall category's chain has no connected
 * provider (or resolved only beyond the category, which the advisor refuses). A permanent state,
 * so it renders as a warning with the fix, never as a gate failure.
 */
export interface KibitzerUnavailableRecord {
  readonly version: 1
  readonly category: string
  readonly cause: "category_unavailable" | "beyond_category" | "pin_unserved"
  readonly missingProviders?: readonly string[]
  /** `pin_unserved`: the bare model id the category pins, which no connected provider serves. */
  readonly pinnedModel?: string
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

// Fail-closed like the gate renderer: the session file is user-writable, so shape and bounds are
// re-validated here even though the producer (observe.ts) already bounded every field.
export const renderKibitzerUnavailableEntry: EntryRenderer<unknown> = (entry, options, theme) => {
  const record = entry.data
  if (!isRecord(record) || record.version !== 1) return undefined
  if (typeof record.category !== "string") return undefined
  const category = normalizeRendererText(record.category).slice(0, UNAVAILABLE_CATEGORY_MAX_CHARS)
  if (category.length === 0) return undefined
  if (record.cause === "pin_unserved") return renderUnservedPin(category, record.pinnedModel, options, theme)
  if (record.cause !== "category_unavailable" && record.cause !== "beyond_category") return undefined
  const providers = unavailableProviders(record.missingProviders)
  if (providers === undefined) return undefined
  const why = record.cause === "category_unavailable"
    ? `No connected provider serves the "${category}" category chain, so recalled-memory judging is off; it resumes by itself once one is connected.`
    : `The "${category}" category chain has no connected model and Kibitzer never falls back beyond the category, so recalled-memory judging is off.`
  const fixes = providers.length > 0
    ? [
      { text: `connect one of: ${providers.join(", ")} (run /login <provider>)`, tone: "dim" as const },
      { text: `or pin categories.${category}.model (or memory.recall.category) in omo.json`, tone: "dim" as const },
    ]
    : [{ text: `pin categories.${category}.model (or memory.recall.category) in omo.json to a connected model`, tone: "dim" as const }]
  return noticeComponent({
    glyph: "⚠",
    title: joinFields(["Kibitzer unavailable", category]),
    tone: "warning",
    why,
    extra: fixes,
    detail: "Kibitzer is pinned to the memory.recall.category chain on purpose: an advisor reading the live transcript must never land on a frontier-priced model outside it.",
  }, options, theme)
}

/** A bare category pin no connected provider serves (#9503): name the pin and the setting, not the chain. */
function renderUnservedPin(
  category: string,
  pinnedModel: unknown,
  options: Parameters<typeof renderKibitzerUnavailableEntry>[1],
  theme: Parameters<typeof renderKibitzerUnavailableEntry>[2],
): ReturnType<typeof renderKibitzerUnavailableEntry> {
  if (typeof pinnedModel !== "string") return undefined
  const pin = normalizeRendererText(pinnedModel).slice(0, UNAVAILABLE_CATEGORY_MAX_CHARS)
  if (pin.length === 0) return undefined
  return noticeComponent({
    glyph: "⚠",
    title: joinFields(["Kibitzer unavailable", category]),
    tone: "warning",
    why: `categories.${category}.model is "${pin}", and no connected provider serves that model, so recalled-memory judging is off; it resumes by itself once one does.`,
    extra: [
      { text: `connect a provider that serves ${pin} (run /login <provider>)`, tone: "dim" as const },
      { text: `or set categories.${category}.model to a model a connected provider serves, e.g. <provider>/${pin}`, tone: "dim" as const },
    ],
    detail: "A model id without a provider runs on whichever connected provider serves it.",
  }, options, theme)
}

function unavailableProviders(value: unknown): readonly string[] | undefined {
  if (value === undefined) return []
  if (!Array.isArray(value)) return undefined
  const providers: string[] = []
  for (const entry of value) {
    if (typeof entry !== "string") return undefined
    const normalized = normalizeRendererText(entry).slice(0, UNAVAILABLE_PROVIDER_MAX_CHARS)
    if (normalized.length > 0) providers.push(normalized)
    if (providers.length >= UNAVAILABLE_PROVIDER_MAX_COUNT) break
  }
  return providers
}

function validGateReason(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const normalized = normalizeRendererText(value)
  if (normalized.length === 0 || normalized.length > GATE_REASON_MAX_CHARS || containsSecretLikeMaterial(value)) return undefined
  if (/[\r\n]/u.test(value)) return undefined
  return normalized
}

/** A stored model or category is drawn only when it is one bounded, secret-free line. */
function validGateField(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== "string" || /[\r\n]/u.test(value) || containsSecretLikeMaterial(value)) return undefined
  const normalized = normalizeRendererText(value)
  return normalized.length === 0 || normalized.length > maxChars ? undefined : normalized
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
  const model = validGateField(record.model, GATE_MODEL_MAX_CHARS)
  const category = validGateField(record.category, UNAVAILABLE_CATEGORY_MAX_CHARS)
  const consecutiveFailures = record.consecutiveFailures
  // The fix names the exact setting when the record knows its recall category; older records and
  // one-shot records do not, and keep the generic hint.
  const fix = category === undefined
    ? "check Kibitzer model/provider settings"
    : `set categories.${category}.model (or memory.recall.category) in omo.json to a model that answers`
  const extra = [
    ...(reason === undefined ? [] : [{ text: reason, tone: "dim" as const }]),
    ...(runId === undefined ? [] : [{ text: `run ${runId}`, tone: "dim" as const }]),
    ...(model === undefined ? [] : [{
      text: `last failed model: ${model}${category === undefined ? "" : ` (memory recall category "${category}")`}`,
      tone: "dim" as const,
    }]),
    { text: `after ${consecutiveFailures} consecutive failures; ${fix}`, tone: "dim" as const },
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
