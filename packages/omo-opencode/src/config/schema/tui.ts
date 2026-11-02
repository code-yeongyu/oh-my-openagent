import { z } from "zod"

export const TuiSidebarConfigSchema = z.object({
  enabled: z.boolean().default(true),
})

export const TuiBtwConfigSchema = z.object({
  session_prompt: z
    .boolean()
    .default(true)
    .describe(
      "Let /btw replace the session prompt slot. Set false when another TUI plugin also replaces the session prompt and two input bars appear; /btw is then unavailable in the TUI.",
    ),
})

export const TuiConfigSchema = z.object({
  sidebar: TuiSidebarConfigSchema.default({ enabled: true }),
  btw: TuiBtwConfigSchema.optional(),
})

export type TuiConfig = z.infer<typeof TuiConfigSchema>
