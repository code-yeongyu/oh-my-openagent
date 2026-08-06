import { z } from "zod"

export const StartWorkConfigSchema = z.object({
  auto_commit: z.boolean().default(true),
})

export type StartWorkConfig = z.infer<typeof StartWorkConfigSchema>
