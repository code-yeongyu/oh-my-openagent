import { z } from "zod"

export const SecurityMissionConfigSchema = z.object({
  enabled: z.boolean().default(false),
  max_findings: z.number().int().min(1).max(10000).default(500),
  persistence_dir: z.string().nullish(),
})

export type SecurityMissionConfig = z.infer<typeof SecurityMissionConfigSchema>
