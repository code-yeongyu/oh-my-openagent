import { readFileSync } from "node:fs"

import { isPlainObject, isUnsafeObjectKey } from "../deep-merge"
import { parseJsoncSafe } from "../jsonc-parser"
import {
  HARNESS_IDS,
  SETTING_HARNESS_SUPPORT,
  type CodegraphConfig,
  type HarnessId,
  type OmoConfig,
} from "../omo-config"

export const BUILT_IN_DEFAULTS: OmoConfig = {
  codegraph: {
    auto_provision: true,
    enabled: true,
    telemetry: false,
  },
}

const HARNESS_BLOCK_KEYS = HARNESS_IDS.map((harness) => `[${harness}]`)

type CodegraphSettingKey = keyof CodegraphConfig
type SettingPath = `codegraph.${CodegraphSettingKey}`
type MutableCodegraphConfig = {
  -readonly [Key in keyof CodegraphConfig]?: CodegraphConfig[Key]
}
type MutableOmoConfig = {
  codegraph?: MutableCodegraphConfig
}

const CODEGRAPH_SETTING_KEYS: readonly CodegraphSettingKey[] = [
  "auto_provision",
  "daemon",
  "enabled",
  "excluded_roots",
  "install_dir",
  "telemetry",
  "watch_debounce_ms",
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value)
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function isCodegraphSettingKey(key: string): key is CodegraphSettingKey {
  return CODEGRAPH_SETTING_KEYS.some((candidate) => candidate === key)
}

function mergeValues(base: unknown, override: unknown): unknown {
  if (override === undefined) return base
  if (Array.isArray(base) && Array.isArray(override)) {
    return [...new Set([...base, ...override])]
  }
  if (isPlainObject(base) && isPlainObject(override)) {
    const result: Record<string, unknown> = { ...base }
    for (const [key, value] of Object.entries(override)) {
      if (isUnsafeObjectKey(key)) continue
      result[key] = mergeValues(result[key], value)
    }
    return result
  }
  return override
}

function mergeCodegraphConfig(
  base: Partial<CodegraphConfig> | undefined,
  override: Partial<CodegraphConfig> | undefined,
): Partial<CodegraphConfig> | undefined {
  const merged = mergeValues(base, override)
  if (!isRecord(merged)) return undefined

  const codegraph: MutableCodegraphConfig = {}
  for (const key of CODEGRAPH_SETTING_KEYS) {
    if (!hasOwn(merged, key)) continue
    setCodegraphSetting(codegraph, key, merged[key])
  }
  return Object.keys(codegraph).length > 0 ? codegraph : undefined
}

export function mergeOmoConfig(base: OmoConfig, override: OmoConfig): OmoConfig {
  const codegraph = mergeCodegraphConfig(base.codegraph, override.codegraph)
  return {
    ...(codegraph === undefined ? {} : { codegraph }),
  }
}

function isHarnessBlockKey(key: string): boolean {
  return key.startsWith("[") && key.endsWith("]")
}

function isKnownHarnessBlockKey(key: string): boolean {
  return HARNESS_BLOCK_KEYS.includes(key)
}

function validateCodegraphValue(key: CodegraphSettingKey, value: unknown): string | null {
  if (key === "excluded_roots") {
    return Array.isArray(value) && value.every((entry) => typeof entry === "string")
      ? null
      : "must be an array of strings"
  }
  if (key === "install_dir") return typeof value === "string" ? null : "must be a string"
  if (key === "watch_debounce_ms") {
    return typeof value === "number" && Number.isFinite(value) && value >= 0
      ? null
      : "must be a non-negative finite number"
  }
  return typeof value === "boolean" ? null : "must be a boolean"
}

function setCodegraphSetting(config: MutableCodegraphConfig, key: CodegraphSettingKey, value: unknown): void {
  switch (key) {
    case "auto_provision":
      if (typeof value === "boolean") config.auto_provision = value
      return
    case "daemon":
      if (typeof value === "boolean") config.daemon = value
      return
    case "enabled":
      if (typeof value === "boolean") config.enabled = value
      return
    case "excluded_roots":
      if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
        config.excluded_roots = value
      }
      return
    case "install_dir":
      if (typeof value === "string") config.install_dir = value
      return
    case "telemetry":
      if (typeof value === "boolean") config.telemetry = value
      return
    case "watch_debounce_ms":
      if (typeof value === "number") config.watch_debounce_ms = value
      return
  }
}

function normalizeCodegraphSection(section: unknown, pathPrefix: string, warnings: string[]): Partial<CodegraphConfig> {
  if (!isRecord(section)) {
    warnings.push(`${pathPrefix} must be an object`)
    return {}
  }

  const codegraph: MutableCodegraphConfig = {}
  for (const [key, value] of Object.entries(section)) {
    if (!isCodegraphSettingKey(key)) {
      warnings.push(`${pathPrefix}.${key} is not a supported setting`)
      continue
    }

    const error = validateCodegraphValue(key, value)
    if (error !== null) {
      warnings.push(`${pathPrefix}.${key} ${error}`)
      continue
    }

    setCodegraphSetting(codegraph, key, value)
  }

  return codegraph
}

function normalizeConfigBody(value: unknown, pathPrefix: string, warnings: string[]): OmoConfig {
  if (!isRecord(value)) {
    warnings.push(`${pathPrefix} must be an object`)
    return {}
  }

  const config: MutableOmoConfig = {}
  for (const [key, section] of Object.entries(value)) {
    if (key === "codegraph") {
      config.codegraph = normalizeCodegraphSection(section, `${pathPrefix}.codegraph`, warnings)
      continue
    }

    if (isHarnessBlockKey(key)) {
      if (!isKnownHarnessBlockKey(key)) {
        warnings.push(`Unknown harness override block "${key}"`)
      }
      continue
    }

    warnings.push(`${pathPrefix}.${key} is not a supported setting`)
  }

  return config
}

function normalizeActiveHarnessBlock(
  value: unknown,
  harness: HarnessId,
  pathPrefix: string,
  warnings: string[],
): OmoConfig {
  if (!isRecord(value)) return {}
  const blockKey = `[${harness}]`
  if (!hasOwn(value, blockKey)) return {}
  return normalizeConfigBody(value[blockKey], `${pathPrefix}.${blockKey}`, warnings)
}

export function loadConfigFile(
  path: string,
  harness: HarnessId,
): { readonly config: OmoConfig; readonly loaded: boolean; readonly warnings: readonly string[] } {
  try {
    const content = readFileSync(path, "utf-8")
    const parsed = parseJsoncSafe<unknown>(content)
    if (parsed.errors.length > 0) {
      return {
        config: {},
        loaded: false,
        warnings: parsed.errors.map((error) => `JSONC parse error in ${path}: ${error.message} at offset ${error.offset}`),
      }
    }

    const warnings: string[] = []
    const baseConfig = normalizeConfigBody(parsed.data, "config", warnings)
    const harnessConfig = normalizeActiveHarnessBlock(parsed.data, harness, "config", warnings)

    return {
      config: mergeOmoConfig(baseConfig, harnessConfig),
      loaded: true,
      warnings,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      config: {},
      loaded: false,
      warnings: [`Failed to read ${path}: ${message}`],
    }
  }
}

export function validateHarnessApplicability(config: OmoConfig, harness: HarnessId): readonly string[] {
  const warnings: string[] = []
  const codegraph = config.codegraph
  if (codegraph === undefined) return warnings

  for (const key of Object.keys(codegraph)) {
    if (!isCodegraphSettingKey(key)) continue
    const settingPath: SettingPath = `codegraph.${key}`
    const supportedHarnesses = SETTING_HARNESS_SUPPORT[settingPath]
    if (supportedHarnesses === undefined) continue
    if (!supportedHarnesses.includes(harness)) {
      warnings.push(`${settingPath} is not supported for harness ${harness}`)
    }
  }

  return warnings
}
