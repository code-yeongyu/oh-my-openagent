import { z } from "zod"

export const McbConfigSchema = z.object({
  enabled: z.boolean().optional(),
  url: z.string().url().optional(),
  default_collection: z.string().optional(),
  auto_index: z.boolean().optional(),
  tools: z
    .object({
      search: z.boolean().optional(),
      memory: z.boolean().optional(),
      index: z.boolean().optional(),
      validate: z.boolean().optional(),
      vcs: z.boolean().optional(),
      session: z.boolean().optional(),
    })
    .optional(),
})

export type McbConfig = z.infer<typeof McbConfigSchema>
