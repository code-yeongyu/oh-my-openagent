import * as z from "zod"

import { OmoAgentsConfigSchema } from "./agent"
import { OmoCategoriesConfigSchema } from "./category"
import { OmoCodegraphSettingsLayerSchema, OmoCodegraphSettingsSchema } from "./codegraph"
import { OmoHarnessIdSchema, type OmoHarnessId } from "./harness"
import { OmoModelCatalogLayerSchema, OmoModelCatalogSchema } from "./model-catalog"
import { OmoTaskSettingsLayerSchema, OmoTaskSettingsSchema } from "./task"
import { OmoTeamsConfigLayerSchema, OmoTeamsConfigSchema } from "./team"

export type { OmoHarnessId }
export { OmoHarnessIdSchema }

export const OmoOpenCodeHarnessConfigSchema = z.record(z.string(), z.unknown())

export const OmoTypedHarnessConfigSchema = z.object({
  categories: OmoCategoriesConfigSchema.optional(),
  agents: OmoAgentsConfigSchema.optional(),
  codegraph: OmoCodegraphSettingsLayerSchema.optional(),
  task: OmoTaskSettingsLayerSchema.optional(),
  teams: OmoTeamsConfigLayerSchema.optional(),
  models: OmoModelCatalogLayerSchema.optional(),
}).strict()

export const OmoConfigProfileSchema = z.object({
  categories: OmoCategoriesConfigSchema.optional(),
  agents: OmoAgentsConfigSchema.optional(),
  codegraph: OmoCodegraphSettingsLayerSchema.optional(),
  task: OmoTaskSettingsLayerSchema.optional(),
  teams: OmoTeamsConfigLayerSchema.optional(),
  models: OmoModelCatalogLayerSchema.optional(),
  "[opencode]": OmoOpenCodeHarnessConfigSchema.optional(),
  "[senpi]": OmoTypedHarnessConfigSchema.optional(),
  "[codex]": OmoTypedHarnessConfigSchema.optional(),
}).strict()

export const OmoConfigSchema = z.object({
  $schema: z.string().optional(),
  categories: OmoCategoriesConfigSchema.optional(),
  agents: OmoAgentsConfigSchema.optional(),
  codegraph: OmoCodegraphSettingsSchema.optional(),
  task: OmoTaskSettingsSchema.optional(),
  teams: OmoTeamsConfigSchema.optional(),
  models: OmoModelCatalogSchema.optional(),
  "[opencode]": OmoOpenCodeHarnessConfigSchema.optional(),
  "[senpi]": OmoTypedHarnessConfigSchema.optional(),
  "[codex]": OmoTypedHarnessConfigSchema.optional(),
  profiles: z.record(z.string(), OmoConfigProfileSchema).default({}),
  _migrations: z.array(z.string()).optional(),
  legacy_migrations: z.record(z.string(), z.unknown()).optional(),
}).strict()

export const OmoConfigLayerSchema = z.object({
  $schema: z.string().optional(),
  categories: OmoCategoriesConfigSchema.optional(),
  agents: OmoAgentsConfigSchema.optional(),
  codegraph: OmoCodegraphSettingsLayerSchema.optional(),
  task: OmoTaskSettingsLayerSchema.optional(),
  teams: OmoTeamsConfigLayerSchema.optional(),
  models: OmoModelCatalogLayerSchema.optional(),
  "[opencode]": OmoOpenCodeHarnessConfigSchema.optional(),
  "[senpi]": OmoTypedHarnessConfigSchema.optional(),
  "[codex]": OmoTypedHarnessConfigSchema.optional(),
  profiles: z.record(z.string(), OmoConfigProfileSchema).optional(),
  _migrations: z.array(z.string()).optional(),
  legacy_migrations: z.record(z.string(), z.unknown()).optional(),
}).strict()

type OmoParsedConfig = z.infer<typeof OmoConfigSchema>

export type OmoConfig = Omit<OmoParsedConfig, "profiles"> & {
  readonly profiles?: OmoParsedConfig["profiles"]
}
