import { normalizeLegacyModelEntry, normalizeLegacyModelFields } from "@oh-my-opencode/omo-config-core"

import { copyRecord, isPlainRecord } from "./record-values"
import type { ConfigMigrationTransformResult } from "./transform-types"

export const REASONING_UNIFICATION_MIGRATION_ID = "2026-08-reasoning-unification"

function normalizeStringModel(value: string): string {
  return normalizeLegacyModelEntry({ model: value }).model
}

function normalizeModelRef(value: unknown): unknown {
  if (typeof value === "string") return normalizeStringModel(value)
  return isPlainRecord(value) ? normalizeLegacyModelEntry(value) : value
}

function normalizedList(value: unknown): unknown[] {
  if (value === undefined) return []
  const entries = Array.isArray(value) ? value : [value]
  return entries.map(normalizeModelRef)
}

function hasModelSettings(record: Readonly<Record<string, unknown>>, opencode: boolean): boolean {
  return [
    "reasoning",
    "variant",
    "reasoningEffort",
    "thinking",
    ...(opencode ? [] : ["provider_options", "providerOptions", "textVerbosity"]),
  ].some((key) => record[key] !== undefined)
}

function primaryModelRef(record: Readonly<Record<string, unknown>>, opencode: boolean): unknown | undefined {
  const model = record["model"]
  if (typeof model !== "string") return undefined
  if (!hasModelSettings(record, opencode)) return normalizeStringModel(model)
  const settings: Record<string, unknown> = { model }
  for (const key of [
    "reasoning",
    "variant",
    "reasoningEffort",
    "thinking",
    ...(opencode ? [] : ["provider_options", "providerOptions", "textVerbosity"]),
  ]) {
    if (record[key] !== undefined) settings[key] = record[key]
  }
  return normalizeLegacyModelEntry(settings)
}

function conflictDiagnostic(record: Readonly<Record<string, unknown>>, path: readonly string[]): string | undefined {
  const present = (["reasoning", "reasoningEffort", "variant"] as const).filter((key) => record[key] !== undefined)
  if (present.length < 2) return undefined
  const [keptKey, ...droppedKeys] = present
  const keptValue = record[keptKey]
  const dropped = droppedKeys.map((key) => [key, record[key]] as const)
  const droppedText = dropped.map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(" ")
  return `conflict: ${path.join(".")} dropped ${droppedText} kept ${keptKey}=${JSON.stringify(keptValue)}`
}

function normalizeDefinition(
  value: unknown,
  kind: "agent" | "category",
  path: readonly string[],
  diagnostics: string[],
  opencode = false,
): unknown {
  if (!isPlainRecord(value)) return value
  const conflict = conflictDiagnostic(value, path)
  if (conflict !== undefined) diagnostics.push(conflict)

  const normalizationInput = opencode ? copyRecord(value) : value
  if (opencode) {
    delete normalizationInput["maxTokens"]
    delete normalizationInput["providerOptions"]
    delete normalizationInput["textVerbosity"]
  }
  const normalized = normalizeLegacyModelFields(normalizationInput)
  if (opencode) {
    for (const key of ["maxTokens", "providerOptions", "textVerbosity"] as const) {
      if (value[key] !== undefined) normalized[key] = value[key]
    }
  }
  if (typeof normalized["model"] === "string") normalized["model"] = normalizeStringModel(normalized["model"])
  if (Array.isArray(normalized["models"])) normalized["models"] = normalizedList(normalized["models"])

  const fallbackModels = value["fallback_models"]
  const shouldCombine = fallbackModels !== undefined || (kind === "agent" && value["model"] !== undefined && value["models"] !== undefined)
  if (!shouldCombine) return normalized

  const primary = primaryModelRef(value, opencode)
  const existing = kind === "agent" ? normalizedList(value["models"]) : []
  const fallbacks = normalizedList(fallbackModels)
  normalized["models"] = [...(primary === undefined ? [] : [primary]), ...existing, ...fallbacks]
  delete normalized["model"]
  delete normalized["fallback_models"]
  for (const key of [
    "reasoning",
    "variant",
    "reasoningEffort",
    "provider_options",
    "providerOptions",
    "thinking",
    "textVerbosity",
  ]) delete normalized[key]
  return normalized
}

function normalizeDefinitions(
  value: unknown,
  kind: "agent" | "category",
  path: readonly string[],
  diagnostics: string[],
): unknown {
  if (!isPlainRecord(value)) return value
  const result: Record<string, unknown> = {}
  for (const [name, definition] of Object.entries(value)) {
    result[name] = normalizeDefinition(definition, kind, [...path, name], diagnostics)
  }
  return result
}

function normalizeOpenCodeDefinitions(
  value: unknown,
  kind: "agent" | "category",
  path: readonly string[],
  diagnostics: string[],
): unknown {
  if (!isPlainRecord(value)) return value
  const result: Record<string, unknown> = {}
  for (const [name, definition] of Object.entries(value)) {
    result[name] = normalizeDefinition(definition, kind, [...path, name], diagnostics, true)
  }
  return result
}

function normalizeCatalog(value: unknown): unknown {
  if (!isPlainRecord(value)) return value
  const result: Record<string, unknown> = {}
  for (const [name, entry] of Object.entries(value)) result[name] = normalizeModelRef(entry)
  return result
}

function normalizeTypedBlock(
  value: unknown,
  path: readonly string[],
  diagnostics: string[],
  recurseProfiles: boolean,
): unknown {
  if (!isPlainRecord(value)) return value
  const result = copyRecord(value)
  if (result["categories"] !== undefined) {
    result["categories"] = normalizeDefinitions(result["categories"], "category", [...path, "categories"], diagnostics)
  }
  if (result["agents"] !== undefined) {
    result["agents"] = normalizeDefinitions(result["agents"], "agent", [...path, "agents"], diagnostics)
  }
  if (result["models"] !== undefined) result["models"] = normalizeCatalog(result["models"])
  for (const harness of ["[senpi]", "[codex]"] as const) {
    if (result[harness] !== undefined) result[harness] = normalizeTypedBlock(result[harness], [...path, harness], diagnostics, false)
  }
  if (result["[opencode]"] !== undefined) {
    result["[opencode]"] = normalizeOpenCodeBlock(result["[opencode]"], [...path, "[opencode]"], diagnostics)
  }
  if (recurseProfiles && isPlainRecord(result["profiles"])) {
    const profiles: Record<string, unknown> = {}
    for (const [name, profile] of Object.entries(result["profiles"])) {
      profiles[name] = normalizeTypedBlock(profile, [...path, "profiles", name], diagnostics, false)
    }
    result["profiles"] = profiles
  }
  return result
}

function normalizeOpenCodeBlock(
  value: unknown,
  path: readonly string[],
  diagnostics: string[],
): unknown {
  if (!isPlainRecord(value)) return value
  const result = copyRecord(value)
  if (result["categories"] !== undefined) {
    result["categories"] = normalizeOpenCodeDefinitions(result["categories"], "category", [...path, "categories"], diagnostics)
  }
  if (result["agents"] !== undefined) {
    result["agents"] = normalizeOpenCodeDefinitions(result["agents"], "agent", [...path, "agents"], diagnostics)
  }
  return result
}

export function transformReasoningUnification(document: unknown): ConfigMigrationTransformResult {
  const diagnostics: string[] = []
  return {
    diagnostics,
    document: isPlainRecord(document)
      ? normalizeTypedBlock(document, [], diagnostics, true) as Record<string, unknown>
      : {},
  }
}
