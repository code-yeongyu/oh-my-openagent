import { z } from "zod"

export const McpPersistenceConfigSchema = z.object({
  enabled: z.boolean().optional().default(true),
  poll_interval_ms: z.number().int().positive().optional().default(5000),
})

export type McpPersistenceConfig = z.infer<typeof McpPersistenceConfigSchema>
