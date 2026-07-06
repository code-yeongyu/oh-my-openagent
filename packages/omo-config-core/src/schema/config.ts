import { z } from "zod"
import { OmoAgentsConfigSchema } from "./agent"
import { OmoCategoriesConfigSchema } from "./category"
import { OmoTaskSettingsSchema } from "./task"
import { OmoTeamsConfigSchema } from "./team"

export const OmoConfigSchema = z.object({
  $schema: z.string().optional(),
  categories: OmoCategoriesConfigSchema.optional(),
  agents: OmoAgentsConfigSchema.optional(),
  task: OmoTaskSettingsSchema.optional(),
  teams: OmoTeamsConfigSchema.optional(),
}).strict()

export type OmoConfig = z.infer<typeof OmoConfigSchema>
