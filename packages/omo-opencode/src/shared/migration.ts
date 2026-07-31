import { configureMigrationCategoryDefaults } from "@oh-my-opencode/utils/migration/agent-category"

import { DEFAULT_CATEGORIES } from "../tools/delegate-task/constants"

configureMigrationCategoryDefaults(DEFAULT_CATEGORIES)

export { AGENT_NAME_MAP, BUILTIN_AGENT_NAMES, migrateAgentNames } from "@oh-my-opencode/utils/migration/agent-names"
export { migrateAgentConfigToCategory, MODEL_TO_CATEGORY_MAP, shouldDeleteAgentConfig } from "@oh-my-opencode/utils/migration/agent-category"
export { HOOK_NAME_MAP, migrateHookNames } from "@oh-my-opencode/utils/migration/hook-names"
export { getSidecarPath, readAppliedMigrations, writeAppliedMigrations } from "@oh-my-opencode/utils/migration/migrations-sidecar"
export { migrateModelVersions, MODEL_VERSION_MAP } from "@oh-my-opencode/utils/migration/model-versions"
