import {
  SETTING_HARNESS_SUPPORT,
  type CodegraphConfig as CoreCodegraphConfig,
  type HarnessId,
} from "@oh-my-opencode/omo-config-core"

export type CodegraphConfig = CoreCodegraphConfig

export type HarnessOverrideConfig = {
  readonly codegraph?: Partial<CodegraphConfig>
}

export type OmoConfig = HarnessOverrideConfig & {
  readonly "[codex]"?: HarnessOverrideConfig
  readonly "[omo]"?: HarnessOverrideConfig
  readonly "[opencode]"?: HarnessOverrideConfig
}

type CodegraphSettingKey = keyof CodegraphConfig
type SettingPath = `codegraph.${CodegraphSettingKey}`

export interface OmoConfigValidationResult {
  readonly errors: readonly string[]
  readonly ok: boolean
}

const HARNESS_BLOCK_KEYS: Record<string, HarnessId> = {
  "[codex]": "codex",
  "[omo]": "omo",
  "[opencode]": "opencode",
}

const SESSION_START_COOLDOWN_FLOOR_MS = 60_000

const CODEGRAPH_VALUE_TYPES: Record<CodegraphSettingKey, "boolean" | "number" | "string" | "string_array"> = {
  auto_provision: "boolean",
  daemon: "boolean",
  enabled: "boolean",
  excluded_roots: "string_array",
  install_dir: "string",
  session_start_cooldown_ms: "number",
  telemetry: "boolean",
  watch_debounce_ms: "number",
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isHarnessBlockKey(key: string): boolean {
  return key.startsWith("[") && key.endsWith("]")
}

function validateCodegraphSection(
  section: unknown,
  pathPrefix: string,
  harness: HarnessId | null,
  errors: string[],
): void {
  if (!isRecord(section)) {
    errors.push(`${pathPrefix} must be an object`)
    return
  }

  for (const [key, value] of Object.entries(section)) {
    if (!(key in CODEGRAPH_VALUE_TYPES)) {
      errors.push(`${pathPrefix}.${key} is not a supported setting`)
      continue
    }

    const settingKey = key as CodegraphSettingKey
    const expectedType = CODEGRAPH_VALUE_TYPES[settingKey]
    if (expectedType === "string_array") {
      if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
        errors.push(`${pathPrefix}.${key} must be an array of strings`)
      }
      continue
    }

    if (typeof value !== expectedType) {
      errors.push(`${pathPrefix}.${key} must be a ${expectedType}`)
      continue
    }

    if (settingKey === "watch_debounce_ms" && typeof value === "number" && (!Number.isFinite(value) || value < 0)) {
      errors.push(`${pathPrefix}.${key} must be a non-negative finite number`)
      continue
    }

    if (
      settingKey === "session_start_cooldown_ms" &&
      typeof value === "number" &&
      (!Number.isFinite(value) || value < SESSION_START_COOLDOWN_FLOOR_MS)
    ) {
      errors.push(`${pathPrefix}.${key} must be a finite number of at least ${SESSION_START_COOLDOWN_FLOOR_MS}`)
      continue
    }

    if (harness !== null) {
      const settingPath: SettingPath = `codegraph.${settingKey}`
      if (!SETTING_HARNESS_SUPPORT[settingPath].includes(harness)) {
        errors.push(`${settingPath} is not supported for harness ${harness}`)
      }
    }
  }
}

function validateConfigBody(value: unknown, pathPrefix: string, harness: HarnessId | null, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${pathPrefix} must be an object`)
    return
  }

  for (const [key, section] of Object.entries(value)) {
    if (key === "codegraph") {
      validateCodegraphSection(section, `${pathPrefix}.codegraph`, harness, errors)
      continue
    }

    if (isHarnessBlockKey(key)) {
      if (harness !== null) {
        errors.push(`${pathPrefix}.${key} cannot contain nested harness override blocks`)
        continue
      }

      const harnessId = HARNESS_BLOCK_KEYS[key]
      if (harnessId === undefined) {
        errors.push(`Unknown harness override block "${key}"`)
        continue
      }
      validateConfigBody(section, key, harnessId, errors)
      continue
    }

    errors.push(`${pathPrefix}.${key} is not a supported setting`)
  }
}

export function validateOmoConfig(value: unknown): OmoConfigValidationResult {
  const errors: string[] = []
  validateConfigBody(value, "config", null, errors)

  return {
    errors,
    ok: errors.length === 0,
  }
}
