import { z } from "zod"

export const CmuxLayoutSchema = z.enum([
  "main-horizontal",
  "main-vertical",
  "tiled",
  "even-horizontal",
  "even-vertical",
])

export const CmuxConfigSchema = z.object({
  enabled: z.boolean().default(false),
  layout: CmuxLayoutSchema.default("main-vertical"),
  main_pane_size: z.number().min(20).max(80).default(60),
  main_pane_min_width: z.number().min(40).default(120),
  agent_pane_min_width: z.number().min(20).default(40),
})

export type CmuxConfig = z.infer<typeof CmuxConfigSchema>
export type CmuxLayout = z.infer<typeof CmuxLayoutSchema>
