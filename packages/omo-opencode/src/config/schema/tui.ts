import { z } from "zod"

export const TuiSidebarConfigSchema = z.object({
  enabled: z.boolean().default(true),
})

export const TuiConfigSchema = z.object({
  sidebar: TuiSidebarConfigSchema.default({ enabled: true }),
})

export type TuiConfig = z.infer<typeof TuiConfigSchema>
