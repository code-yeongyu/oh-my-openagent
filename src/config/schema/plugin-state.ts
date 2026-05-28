import { z } from "zod"

export const PluginStateSchema = z.object({
  enabled: z.boolean().optional(),
})

export type PluginState = z.infer<typeof PluginStateSchema>
