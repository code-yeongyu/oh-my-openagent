import { z } from "zod"

export const UlwExecuteConfigSchema = z.object({
  auto_commit: z.boolean().default(true),
})

export type UlwExecuteConfig = z.infer<typeof UlwExecuteConfigSchema>
