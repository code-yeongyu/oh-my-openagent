import * as z from "zod"

import { OmoAgentsConfigSchema } from "./agent"
import { OmoCategoriesConfigSchema } from "./category"
import { OmoGitMasterSettingsLayerSchema, OmoGitMasterSettingsSchema } from "./git-master"
import { OmoHarnessIdSchema, type OmoHarnessId } from "./harness"
import { OmoMemorySettingsLayerSchema, OmoMemorySettingsSchema } from "./memory"
import { OmoModelCatalogLayerSchema, OmoModelCatalogSchema } from "./model-catalog"
import { OmoModelProfilesLayerSchema, OmoModelProfilesSchema } from "./model-profile"
import { OmoTaskSettingsLayerSchema, OmoTaskSettingsSchema } from "./task"
import { OmoTeamsConfigLayerSchema, OmoTeamsConfigSchema } from "./team"
import { OmoTelemetrySettingsLayerSchema, OmoTelemetrySettingsSchema } from "./telemetry"
import { OmoFormatOnMutationLayerSchema, OmoFormatOnMutationSchema } from "./format-on-mutation"

export type { OmoHarnessId }
export { OmoHarnessIdSchema }

export const OmoOpenCodeHarnessConfigSchema = z.record(z.string(), z.unknown())

/**
 * Canonical skill denylist. Names listed here are absent from the run on every harness that
 * loads the skill; layers (user, project, `[harness]`, profile) are unioned, never replaced.
 */
export const OmoDisabledSkillsSchema = z.array(z.string())

export const OmoTypedHarnessConfigSchema = z.object({
  formatOnMutation: OmoFormatOnMutationLayerSchema.optional(),
  categories: OmoCategoriesConfigSchema.optional(),
  agents: OmoAgentsConfigSchema.optional(),
  git_master: OmoGitMasterSettingsLayerSchema.optional(),
  task: OmoTaskSettingsLayerSchema.optional(),
  teams: OmoTeamsConfigLayerSchema.optional(),
  models: OmoModelCatalogLayerSchema.optional(),
  model_profiles: OmoModelProfilesLayerSchema.optional(),
  model_profile: z.string().optional(),
  memory: OmoMemorySettingsLayerSchema.optional(),
  telemetry: OmoTelemetrySettingsLayerSchema.optional(),
  disabled_skills: OmoDisabledSkillsSchema.optional(),
}).strict()

export const OmoConfigProfileSchema = z.object({
  formatOnMutation: OmoFormatOnMutationLayerSchema.optional(),
  categories: OmoCategoriesConfigSchema.optional(),
  agents: OmoAgentsConfigSchema.optional(),
  git_master: OmoGitMasterSettingsLayerSchema.optional(),
  task: OmoTaskSettingsLayerSchema.optional(),
  teams: OmoTeamsConfigLayerSchema.optional(),
  models: OmoModelCatalogLayerSchema.optional(),
  model_profiles: OmoModelProfilesLayerSchema.optional(),
  model_profile: z.string().optional(),
  memory: OmoMemorySettingsLayerSchema.optional(),
  telemetry: OmoTelemetrySettingsLayerSchema.optional(),
  disabled_skills: OmoDisabledSkillsSchema.optional(),
  "[opencode]": OmoOpenCodeHarnessConfigSchema.optional(),
  "[native]": OmoTypedHarnessConfigSchema.optional(),
  "[senpi]": OmoTypedHarnessConfigSchema.optional(),
  "[codex]": OmoTypedHarnessConfigSchema.optional(),
}).strict()

export const OmoConfigSchema = z.object({
  formatOnMutation: OmoFormatOnMutationSchema.optional(),
  $schema: z.string().optional(),
  categories: OmoCategoriesConfigSchema.optional(),
  agents: OmoAgentsConfigSchema.optional(),
  git_master: OmoGitMasterSettingsSchema.optional(),
  task: OmoTaskSettingsSchema.optional(),
  teams: OmoTeamsConfigSchema.optional(),
  models: OmoModelCatalogSchema.optional(),
  model_profiles: OmoModelProfilesSchema.optional(),
  model_profile: z.string().optional(),
  memory: OmoMemorySettingsSchema.optional(),
  telemetry: OmoTelemetrySettingsSchema.optional(),
  disabled_skills: OmoDisabledSkillsSchema.optional(),
  "[opencode]": OmoOpenCodeHarnessConfigSchema.optional(),
  "[native]": OmoTypedHarnessConfigSchema.optional(),
  "[senpi]": OmoTypedHarnessConfigSchema.optional(),
  "[codex]": OmoTypedHarnessConfigSchema.optional(),
  profiles: z.record(z.string(), OmoConfigProfileSchema).default({}),
  _migrations: z.array(z.string()).optional(),
  legacy_migrations: z.record(z.string(), z.unknown()).optional(),
}).strict()

export const OmoConfigLayerSchema = z.object({
  formatOnMutation: OmoFormatOnMutationLayerSchema.optional(),
  $schema: z.string().optional(),
  categories: OmoCategoriesConfigSchema.optional(),
  agents: OmoAgentsConfigSchema.optional(),
  git_master: OmoGitMasterSettingsLayerSchema.optional(),
  task: OmoTaskSettingsLayerSchema.optional(),
  teams: OmoTeamsConfigLayerSchema.optional(),
  models: OmoModelCatalogLayerSchema.optional(),
  model_profiles: OmoModelProfilesLayerSchema.optional(),
  model_profile: z.string().optional(),
  memory: OmoMemorySettingsLayerSchema.optional(),
  telemetry: OmoTelemetrySettingsLayerSchema.optional(),
  disabled_skills: OmoDisabledSkillsSchema.optional(),
  "[opencode]": OmoOpenCodeHarnessConfigSchema.optional(),
  "[native]": OmoTypedHarnessConfigSchema.optional(),
  "[senpi]": OmoTypedHarnessConfigSchema.optional(),
  "[codex]": OmoTypedHarnessConfigSchema.optional(),
  profiles: z.record(z.string(), OmoConfigProfileSchema).optional(),
  _migrations: z.array(z.string()).optional(),
  legacy_migrations: z.record(z.string(), z.unknown()).optional(),
}).strict()

type OmoParsedConfig = z.infer<typeof OmoConfigSchema>

export type OmoConfig = Omit<OmoParsedConfig, "profiles" | "formatOnMutation"> & {
  readonly profiles?: OmoParsedConfig["profiles"]
  readonly formatOnMutation?: OmoParsedConfig["formatOnMutation"]
}
