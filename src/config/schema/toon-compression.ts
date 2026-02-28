import { z } from "zod"

export const ToonCompressionConfigSchema = z.object({
  enabled: z.boolean().default(false),
  threshold: z.number().min(10).default(100),
  maxEncodingSize: z.number().min(1000).optional(),
})

export type ToonCompressionConfig = z.infer<typeof ToonCompressionConfigSchema>
