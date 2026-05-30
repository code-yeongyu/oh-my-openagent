import { getBundledModelCapabilitiesSnapshot, getModelCapabilities } from "../model-capabilities"

/**
 * Model version migration map: old full model strings → new full model strings.
 * Used to auto-upgrade hardcoded model versions in user configs when the plugin
 * bumps to newer model versions.
 *
 * Keys are full "provider/model" strings. Only openai and anthropic entries needed.
 *
 * Only include genuinely retired/superseded models here. Config migration must
 * never rewrite a model that is still present as a canonical bundled
 * capabilities entry: if the current runtime still recognizes that exact
 * provider/model as a live model, we preserve the user's explicit choice even
 * when a historical migration map entry exists. Auto-rewriting current models
 * broke configs in practice (#3777, #4527).
 */
export const MODEL_VERSION_MAP: Record<string, string> = {
  "anthropic/claude-opus-4-5": "anthropic/claude-opus-4-7",
  "anthropic/claude-opus-4-6": "anthropic/claude-opus-4-7",
  "anthropic/claude-sonnet-4-5": "anthropic/claude-sonnet-4-6",
}

const bundledSnapshot = getBundledModelCapabilitiesSnapshot()

function migrationKey(oldModel: string, newModel: string): string {
  return `model-version:${oldModel}->${newModel}`
}

function splitProviderModel(model: string): { providerID: string; modelID: string } | null {
  const normalizedModel = model.trim().toLowerCase()
  const slashIndex = normalizedModel.indexOf("/")
  if (slashIndex <= 0 || slashIndex === normalizedModel.length - 1) {
    return null
  }

  return {
    providerID: normalizedModel.slice(0, slashIndex),
    modelID: normalizedModel.slice(slashIndex + 1),
  }
}

export function isBundledCanonicalModel(model: string): boolean {
  const parsed = splitProviderModel(model)
  if (!parsed) {
    return false
  }

  const capabilities = getModelCapabilities({
    providerID: parsed.providerID,
    modelID: parsed.modelID,
    bundledSnapshot,
  })

  return capabilities.diagnostics.snapshot.source === "bundled-snapshot"
    && capabilities.diagnostics.canonicalization.source === "canonical"
    && capabilities.canonicalModelID === parsed.modelID
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
      if (typeof config.model === "string" && MODEL_VERSION_MAP[config.model]) {
        const oldModel = config.model
        if (isBundledCanonicalModel(oldModel)) {
          migrated[key] = value
          continue
        }

        const newModel = MODEL_VERSION_MAP[oldModel]
        const mKey = migrationKey(oldModel, newModel)

        // Skip if this migration was already applied (user may have reverted)
        if (appliedMigrations?.has(mKey)) {
          migrated[key] = value
          continue
        }

        migrated[key] = { ...config, model: newModel }
        changed = true
        newMigrations.push(mKey)
        continue
      }
    }
    migrated[key] = value
  }

  return { migrated, changed, newMigrations }
}
