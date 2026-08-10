export {
  AGENT_NAME_MAP,
  BUILTIN_AGENT_NAMES,
  HOOK_NAME_MAP,
  MODEL_VERSION_MAP,
  migrateAgentNames,
  migrateHookNames,
  migrateModelVersions,
} from "@oh-my-opencode/omo-config-core"
export { MODEL_TO_CATEGORY_MAP, migrateAgentConfigToCategory, shouldDeleteAgentConfig } from "./migration/agent-category"
export { migrateConfigFile } from "./migration/config-migration"
