import * as z from "zod"

import { OmoModelRefObjectSchema, OmoReasoningSchema, type OmoModelRefObject } from "./model-ref"
import { normalizeReasoning, splitReasoningSuffix } from "./reasoning-vocabulary"

export const OmoThinkingConfigSchema = z.object({
  type: z.enum(["enabled", "disabled"]),
  budgetTokens: z.number().optional(),
}).strict()

/** @deprecated Use OmoReasoningSchema. */
export const OmoReasoningEffortSchema = OmoReasoningSchema

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function canonicalReasoning(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const normalized = normalizeReasoning(value)
  return normalized.level ?? normalized.passthrough
}

function canonicalModelString(model: string): string {
  const colon = splitReasoningSuffix(model, { allowMaxSuffix: true })
  if (colon.level !== undefined) return `${colon.base}:${colon.level}`

  const trimmed = model.trim()
  const parenthesized = trimmed.match(/^(.*)\(([^()]+)\)\s*$/)
  const spaced = parenthesized === null ? trimmed.match(/^(.*\S)\s+([a-z][a-z0-9_-]*)$/i) : null
  const base = (parenthesized?.[1] ?? spaced?.[1])?.trim()
  const token = (parenthesized?.[2] ?? spaced?.[2])?.trim()
  if (base === undefined || token === undefined) return trimmed
  const normalized = normalizeReasoning(token)
  return normalized.level === undefined ? trimmed : `${base}:${normalized.level}`
}

export function normalizeLegacyModelFields(entry: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...entry }
  delete normalized["variant"]
  delete normalized["reasoningEffort"]
  delete normalized["thinking"]
  delete normalized["textVerbosity"]
  delete normalized["maxTokens"]
  delete normalized["providerOptions"]

  if (typeof entry["model"] === "string") normalized["model"] = canonicalModelString(entry["model"])

  const explicitReasoning = canonicalReasoning(entry["reasoning"])
  const variant = canonicalReasoning(entry["variant"])
  const reasoningEffort = canonicalReasoning(entry["reasoningEffort"])
  const thinking = isRecord(entry["thinking"]) ? entry["thinking"] : undefined
  const reasoning = explicitReasoning
    ?? reasoningEffort
    ?? variant
    ?? (thinking?.["type"] === "disabled" ? "off" : undefined)
  if (reasoning !== undefined) normalized["reasoning"] = reasoning

  const providerOptions = isRecord(entry["provider_options"])
    ? { ...entry["provider_options"] }
    : isRecord(entry["providerOptions"])
      ? { ...entry["providerOptions"] }
      : {}
  if (thinking?.["type"] === "enabled") providerOptions["thinking"] = { ...thinking }
  if (entry["textVerbosity"] !== undefined) providerOptions["textVerbosity"] = entry["textVerbosity"]
  if (Object.keys(providerOptions).length > 0) normalized["provider_options"] = providerOptions

  if (entry["max_tokens"] !== undefined) normalized["max_tokens"] = entry["max_tokens"]
  else if (entry["maxTokens"] !== undefined) normalized["max_tokens"] = entry["maxTokens"]

  return normalized
}

export function normalizeLegacyModelEntry(entry: Readonly<Record<string, unknown>>): OmoModelRefObject {
  return OmoModelRefObjectSchema.parse(normalizeLegacyModelFields(entry))
}

const OmoLegacyFallbackModelObjectInputSchema = z.object({
  model: z.string(),
  reasoning: OmoReasoningSchema.optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  max_tokens: z.number().int().positive().optional(),
  provider_options: z.record(z.string(), z.unknown()).optional(),
  /** @deprecated Use reasoning. */
  variant: z.string().optional(),
  /** @deprecated Use reasoning. */
  reasoningEffort: OmoReasoningEffortSchema.optional(),
  /** @deprecated Use provider_options.thinking or reasoning: "off". */
  thinking: OmoThinkingConfigSchema.optional(),
  /** @deprecated Use provider_options.textVerbosity. */
  textVerbosity: z.enum(["low", "medium", "high"]).optional(),
  /** @deprecated Use max_tokens. */
  maxTokens: z.number().optional(),
  /** @deprecated Use provider_options. */
  providerOptions: z.record(z.string(), z.unknown()).optional(),
}).strict()

export const OmoFallbackModelObjectSchema = z.preprocess(
  (value) => isRecord(value) ? normalizeLegacyModelFields(value) : value,
  OmoLegacyFallbackModelObjectInputSchema,
)

export const OmoFallbackModelsSchema = z.union([
  z.string(),
  z.array(z.string()),
  z.array(OmoFallbackModelObjectSchema),
  z.array(z.union([z.string(), OmoFallbackModelObjectSchema])),
])

export type OmoReasoningEffort = z.infer<typeof OmoReasoningEffortSchema>
export type OmoFallbackModelObject = z.infer<typeof OmoFallbackModelObjectSchema>
export type OmoFallbackModels = z.infer<typeof OmoFallbackModelsSchema>
