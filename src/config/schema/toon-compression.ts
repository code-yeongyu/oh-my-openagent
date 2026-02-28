import { z } from "zod"

export const ToonCompressionConfigSchema = z.object({
  enabled: z.boolean().default(false),
  threshold: z.number().min(10).default(5000),
  maxEncodingSize: z.number().min(10240).optional(),
})

export type ToonCompressionConfig = z.infer<typeof ToonCompressionConfigSchema>
