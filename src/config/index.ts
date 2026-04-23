export { expandProfile, PROFILE_NAMES } from "./profiles"
export type { ProfileName } from "./profiles"

export {
  MatrixxConfigSchema,
  AgentOverrideConfigSchema,
  AgentOverridesSchema,
  McpNameSchema,
  AgentNameSchema,
  HookNameSchema,
  BuiltinCommandNameSchema,
  MorpheusAgentConfigSchema,
  ExperimentalConfigSchema,
  MatrixLoopConfigSchema,
  SecurityConfigSchema,
  TmuxConfigSchema,
  TmuxLayoutSchema,
  RuntimeFallbackConfigSchema,
} from "./schema"

export type {
  MatrixxConfig,
  AgentOverrideConfig,
  AgentOverrides,
  McpName,
  AgentName,
  HookName,
  BuiltinCommandName,
  MorpheusAgentConfig,
  ExperimentalConfig,
  DynamicContextPruningConfig,
  MatrixLoopConfig,
  SecurityConfig,
  SecretScanningConfig,
  EnvFileGuardConfig,
  DependencyAuditConfig,
  TmuxConfig,
  TmuxLayout,
  MorpheusConfig,
  MorpheusTasksConfig,
  RuntimeFallbackConfig,
  AgentDefinitions,
  ModelCapabilitiesConfig,
} from "./schema"
