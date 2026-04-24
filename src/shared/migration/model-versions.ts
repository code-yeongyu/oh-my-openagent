import { transformModelForProvider } from "../provider-model-id-transform"

/**
 * Model version migration map: old full model strings → new full model strings.
 * Used to auto-upgrade hardcoded model versions in user configs when the plugin
 * bumps to newer model versions.
 *
 * Keys are full "provider/model" strings. Legacy provider aliases that need
 * provider-specific rewrites are handled below instead of being hardcoded here.
 */
export const MODEL_VERSION_MAP: Record<string, string> = {
  "anthropic/claude-opus-4-5": "anthropic/claude-opus-4-7",
  "anthropic/claude-opus-4-6": "anthropic/claude-opus-4-7",
  "anthropic/claude-sonnet-4-5": "anthropic/claude-sonnet-4-6",
  "openai/gpt-5.3-codex": "openai/gpt-5.4",
  "openai/gpt-5.4": "openai/gpt-5.5",
}

const LEGACY_GATEWAY_PREFIX = "gateway/"

function migrationKey(oldModel: string, newModel: string): string {
  return `model-version:${oldModel}->${newModel}`
}

function migrateLegacyGatewayAlias(oldModel: string): string | undefined {
  if (!oldModel.startsWith(LEGACY_GATEWAY_PREFIX)) {
    return undefined
  }

  const legacyModel = oldModel.slice(LEGACY_GATEWAY_PREFIX.length)
  return `vercel/${transformModelForProvider("vercel", legacyModel)}`
}

function getMigratedModel(oldModel: string): string | undefined {
  return migrateLegacyGatewayAlias(oldModel) ?? MODEL_VERSION_MAP[oldModel]
}

function applyModelMigration(
  oldModel: string,
  appliedMigrations?: Set<string>
): { changed: false; model: string } | { changed: true; model: string; migrationKey: string } {
  const newModel = getMigratedModel(oldModel)
  if (!newModel) {
    return { changed: false, model: oldModel }
  }

  const mKey = migrationKey(oldModel, newModel)
  if (appliedMigrations?.has(mKey)) {
    return { changed: false, model: oldModel }
  }

  return { changed: true, model: newModel, migrationKey: mKey }
}

export function migrateModelVersions(
  configs: Record<string, unknown>,
  appliedMigrations?: Set<string>
): { migrated: Record<string, unknown>; changed: boolean; newMigrations: string[] } {
  const migrated: Record<string, unknown> = {}
  let changed = false
  const newMigrations: string[] = []

  for (const [key, value] of Object.entries(configs)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const config = value as Record<string, unknown>
      const migratedConfig = { ...config }
      let configChanged = false

      if (typeof config.model === "string") {
        const modelMigration = applyModelMigration(config.model, appliedMigrations)
        if (modelMigration.changed) {
          migratedConfig.model = modelMigration.model
          configChanged = true
          if (!newMigrations.includes(modelMigration.migrationKey)) {
            newMigrations.push(modelMigration.migrationKey)
          }
        }
      }

      if (Array.isArray(config.fallback_models)) {
        const migratedFallbackModels = config.fallback_models.map((entry) => {
          if (typeof entry === "string") {
            const fallbackMigration = applyModelMigration(entry, appliedMigrations)
            if (fallbackMigration.changed) {
              configChanged = true
              if (!newMigrations.includes(fallbackMigration.migrationKey)) {
                newMigrations.push(fallbackMigration.migrationKey)
              }
            }
            return fallbackMigration.model
          }

          if (entry && typeof entry === "object" && !Array.isArray(entry)) {
            const fallbackConfig = entry as Record<string, unknown>
            if (typeof fallbackConfig.model === "string") {
              const fallbackMigration = applyModelMigration(fallbackConfig.model, appliedMigrations)
              if (fallbackMigration.changed) {
                configChanged = true
                if (!newMigrations.includes(fallbackMigration.migrationKey)) {
                  newMigrations.push(fallbackMigration.migrationKey)
                }
                return { ...fallbackConfig, model: fallbackMigration.model }
              }
            }
          }

          return entry
        })

        if (configChanged) {
          migratedConfig.fallback_models = migratedFallbackModels
        }
      }

      if (configChanged) {
        migrated[key] = migratedConfig
        changed = true
        continue
      }
    }
    migrated[key] = value
  }

  return { migrated, changed, newMigrations }
}
