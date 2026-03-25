import { z } from "zod"

export const ModelCapabilitiesConfigSchema = z.object({
  enabled: z.boolean().optional(),
  auto_refresh_on_start: z.boolean().optional(),
  refresh_timeout_ms: z.number().int().positive().optional(),
  source_url: z.string().url().optional(),
})

export type ModelCapabilitiesConfig = z.infer<typeof ModelCapabilitiesConfigSchema>
