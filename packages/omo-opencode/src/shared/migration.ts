import { configureMigrationCategoryDefaults } from "@oh-my-opencode/utils/migration/agent-category"

import { DEFAULT_CATEGORIES } from "../tools/delegate-task/constants"

configureMigrationCategoryDefaults(DEFAULT_CATEGORIES)

export {
  AGENT_NAME_MAP,
  BUILTIN_AGENT_NAMES,
  HOOK_NAME_MAP,
  MODEL_VERSION_MAP,
  migrateAgentNames,
  migrateHookNames,
  migrateModelVersions,
} from "@oh-my-opencode/omo-config-core"
export { migrateAgentConfigToCategory, MODEL_TO_CATEGORY_MAP, shouldDeleteAgentConfig } from "@oh-my-opencode/utils/migration/agent-category"
export { getSidecarPath, readAppliedMigrations, writeAppliedMigrations } from "@oh-my-opencode/utils/migration/migrations-sidecar"
