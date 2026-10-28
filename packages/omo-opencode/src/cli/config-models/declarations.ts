import { normalizeLegacyModelFields } from "@oh-my-opencode/omo-config-core"
import { isPlainRecord } from "@oh-my-opencode/utils"

import type { ModelDeclaration, ModelMapEntry } from "./types"

function settings(record: Readonly<Record<string, unknown>>) {
  return {
    ...(typeof record.reasoning === "string" ? { reasoning: record.reasoning } : {}),
    ...(typeof record.variant === "string" ? { variant: record.variant } : {}),
    ...(typeof record.reasoningEffort === "string" ? { reasoningEffort: record.reasoningEffort } : {}),
  }
}

function entries(value: unknown, normalize: boolean): readonly ModelMapEntry[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.flatMap((entry): ModelMapEntry[] => {
    if (typeof entry === "string") return [entry]
    if (!isPlainRecord(entry) || typeof entry.model !== "string") return []
    const record = normalize ? normalizeLegacyModelFields(entry) : entry
    return [{ model: String(record.model), ...settings(record) }]
  })
}

export function projectDeclarations(config: Readonly<Record<string, unknown>>, keyPrefix: string): readonly ModelDeclaration[] {
  const declarations: ModelDeclaration[] = []
  const normalize = !keyPrefix.endsWith("[opencode].")
  for (const section of ["agents", "categories"] as const) {
    const definitions = config[section]
    if (!isPlainRecord(definitions)) continue
    for (const [name, value] of Object.entries(definitions)) {
      if (!isPlainRecord(value)) continue
      const record = normalize ? normalizeLegacyModelFields(value) : value
      const models = entries(record.models, normalize)
      const fallback = typeof record.fallback_models === "string" ? record.fallback_models : entries(record.fallback_models, normalize)
      const fields = {
        ...(typeof record.category === "string" ? { category: record.category } : {}),
        ...(typeof record.model === "string" ? { model: record.model } : {}),
        ...(models === undefined ? {} : { models }),
        ...(fallback === undefined ? {} : { fallback_models: fallback }),
        ...settings(record),
        ...(typeof record.disable === "boolean" ? { disable: record.disable } : {}),
      }
      if (Object.keys(fields).length === 0) continue
      declarations.push({ section, name, key: `${keyPrefix}${section}.${name}`, ...fields })
    }
  }
  return declarations
}
