/**
 * Model version migration map: old full model strings → new full model strings.
 * Used to auto-upgrade hardcoded model versions in user configs when the plugin
 * bumps to newer model versions.
 *
 * Keys are full "provider/model" strings. Only openai and anthropic entries needed.
 *
 * Only include genuinely retired/superseded models here. Do NOT add mappings
 * for current, user-selectable variants like `gpt-5.5`, the canonical
 * codex powerhouse referenced in docs/guide/agent-model-matching.md. The
 * same rule applies to top-level primary models like `openai/gpt-5.4`
 * while they remain user-selectable:
 * config migrations must not silently rewrite an explicit user choice to a
 * newer default. Auto-rewriting current models broke configs in practice
 * (#3777, #4527).
 */
export const MODEL_VERSION_MAP: Record<string, string> = {
  "anthropic/claude-opus-4-4": "anthropic/claude-opus-4-7",
}

type ScopedModelMigration = { model: string; variant?: string }

/**
 * Entry-scoped migrations: applied only when a specific agent/category entry
 * is pinned to the old model. Unlike MODEL_VERSION_MAP this may move entries
 * off a still-selectable model, because it narrowly retargets entries whose
 * pinned value matches the PREVIOUS built-in default (typically written by the
 * installer, not chosen by hand). Other entries pinned to the same model are
 * untouched, and the sidecar prevents re-applying after a user revert.
 *
 * GPT-5.6 default rollout: hephaestus keeps the user's variant; deep and
 * ultrabrain adopt the new default variants (high / xhigh).
 */
export const ENTRY_SCOPED_MODEL_VERSION_MAP: Record<string, Record<string, ScopedModelMigration>> = {
  hephaestus: {
    "openai/gpt-5.5": { model: "openai/gpt-5.6-sol" },
  },
  deep: {
    "openai/gpt-5.5": { model: "openai/gpt-5.6-sol", variant: "high" },
  },
  ultrabrain: {
    "openai/gpt-5.5": { model: "openai/gpt-5.6-sol", variant: "xhigh" },
  },
}

const CURRENT_USER_SELECTABLE_MODELS = new Set([
  "anthropic/claude-opus-4-5",
  "anthropic/claude-opus-4-6",
  "anthropic/claude-sonnet-4-5",
])

function migrationKey(oldModel: string, newModel: string): string {
  return `model-version:${oldModel}->${newModel}`
}

function scopedMigrationKey(entry: string, oldModel: string, newModel: string): string {
  return `model-version:${entry}:${oldModel}->${newModel}`
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
      const scopedMigration =
        typeof config.model === "string"
          ? ENTRY_SCOPED_MODEL_VERSION_MAP[key]?.[config.model]
          : undefined
      if (scopedMigration && typeof config.model === "string") {
        const oldModel = config.model
        const mKey = scopedMigrationKey(key, oldModel, scopedMigration.model)

        if (appliedMigrations?.has(mKey)) {
          migrated[key] = value
          continue
        }

        migrated[key] = {
          ...config,
          model: scopedMigration.model,
          ...(scopedMigration.variant ? { variant: scopedMigration.variant } : {}),
        }
        changed = true
        newMigrations.push(mKey)
        continue
      }
      if (
        typeof config.model === "string" &&
        !CURRENT_USER_SELECTABLE_MODELS.has(config.model) &&
        MODEL_VERSION_MAP[config.model]
      ) {
        const oldModel = config.model
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
