import { z } from "zod"

export const TmuxLayoutSchema = z.enum([
  "main-horizontal", // main pane top, agent panes bottom stack
  "main-vertical", // main pane left, agent panes right stack (default)
  "tiled", // all panes same size grid
  "even-horizontal", // all panes horizontal row
  "even-vertical", // all panes vertical stack
])

export const TmuxConfigSchema = z.object({
  enabled: z.boolean().default(false),
  layout: TmuxLayoutSchema.default("main-vertical"),
  main_pane_size: z.number().min(20).max(80).default(60),
  main_pane_min_width: z.number().min(40).default(120),
  agent_pane_min_width: z.number().min(20).default(40),
})

export type TmuxConfig = z.infer<typeof TmuxConfigSchema>
export type TmuxLayout = z.infer<typeof TmuxLayoutSchema>
