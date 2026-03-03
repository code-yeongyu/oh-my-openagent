import { z } from "zod"

export const BabysittingConfigSchema = z.object({
  timeout_ms: z.number().default(120000),
})

export type BabysittingConfig = z.infer<typeof BabysittingConfigSchema>
