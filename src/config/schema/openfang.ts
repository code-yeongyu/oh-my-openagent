import { z } from "zod"

export const OpenfangConfigSchema = z.object({
  base_url: z.string().default("http://127.0.0.1:50051"),
})

export type OpenfangConfig = z.infer<typeof OpenfangConfigSchema>
