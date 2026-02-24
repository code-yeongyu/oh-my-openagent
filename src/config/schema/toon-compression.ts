import { z } from "zod"

export const ToonCompressionConfigSchema = z.object({
  enabled: z.boolean().default(false),
  threshold: z.number().min(100).default(5000),
})

export type ToonCompressionConfig = z.infer<typeof ToonCompressionConfigSchema>
