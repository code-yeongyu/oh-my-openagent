import { z } from "zod"

export const McbConfigSchema = z.object({
  enabled: z.boolean().optional(),
  url: z.string().url().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  data_dir: z.string().optional(),
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
