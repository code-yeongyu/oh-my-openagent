import type { CodegraphConfig, HarnessId, OmoConfig } from "../omo-config"

type CodegraphSettingKey = keyof CodegraphConfig
type MutableCodegraphConfig = {
  -readonly [Key in keyof CodegraphConfig]?: CodegraphConfig[Key]
}

const CODEGRAPH_ENV_KEYS: readonly [CodegraphSettingKey, string, "boolean" | "number" | "string"][] = [
  ["auto_provision", "AUTO_PROVISION", "boolean"],
  ["enabled", "ENABLED", "boolean"],
  ["install_dir", "INSTALL_DIR", "string"],
  ["telemetry", "TELEMETRY", "boolean"],
  ["watch_debounce_ms", "WATCH_DEBOUNCE_MS", "number"],
]

function parseBooleanEnv(value: string): boolean | null {
  const normalized = value.trim().toLowerCase()
  if (["1", "true", "yes", "on"].includes(normalized)) return true
  if (["0", "false", "no", "off"].includes(normalized)) return false
  return null
}

function parseEnvValue(value: string, kind: "boolean" | "number" | "string"): boolean | number | string | null {
  if (kind === "boolean") return parseBooleanEnv(value)
  if (kind === "number") {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
  }
  return value
}

function setCodegraphSetting(config: MutableCodegraphConfig, key: CodegraphSettingKey, value: unknown): void {
  switch (key) {
    case "auto_provision":
      if (typeof value === "boolean") config.auto_provision = value
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

export function buildEnvOverrides(
  harness: HarnessId,
  env: Record<string, string | undefined>,
  warnings: string[],
  merge: (base: OmoConfig, override: OmoConfig) => OmoConfig,
): OmoConfig {
  let config: OmoConfig = {}
  for (const prefix of ["OMO", harness.toUpperCase()]) {
    const codegraph: MutableCodegraphConfig = {}
    for (const [settingKey, envSuffix, kind] of CODEGRAPH_ENV_KEYS) {
      const envKey = `${prefix}_CODEGRAPH_${envSuffix}`
      const rawValue = env[envKey]
      if (rawValue === undefined) continue

      const parsed = parseEnvValue(rawValue, kind)
      if (parsed === null) {
        warnings.push(`${envKey} has invalid ${kind} value "${rawValue}"`)
        continue
      }
      setCodegraphSetting(codegraph, settingKey, parsed)
    }

    if (Object.keys(codegraph).length > 0) {
      config = merge(config, { codegraph })
    }
  }
  return config
}
