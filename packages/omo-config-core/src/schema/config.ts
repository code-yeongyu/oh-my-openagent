import * as z from "zod"
import { OmoAgentsConfigSchema } from "./agent"
import { OmoCategoriesConfigSchema } from "./category"
import { OmoTaskSettingsSchema } from "./task"
import { OmoTeamsConfigLayerSchema, OmoTeamsConfigSchema } from "./team"

export const OmoConfigSchema = z.object({
  $schema: z.string().optional(),
  categories: OmoCategoriesConfigSchema.optional(),
  agents: OmoAgentsConfigSchema.optional(),
  task: OmoTaskSettingsSchema.optional(),
  teams: OmoTeamsConfigSchema.optional(),
}).strict()

export const OmoConfigLayerSchema = z.object({
  $schema: z.string().optional(),
  categories: OmoCategoriesConfigSchema.optional(),
  agents: OmoAgentsConfigSchema.optional(),
  task: OmoTaskSettingsSchema.optional(),
  teams: OmoTeamsConfigLayerSchema.optional(),
}).strict()

export type OmoConfig = z.infer<typeof OmoConfigSchema>
