import { z } from "zod"

export const BeadsConfigSchema = z.object({
  enabled: z.boolean().default(false),
  auto_init: z.boolean().default(true),
  backend: z.enum(["cli", "mcp", "auto"]).default("cli"),
  sync_on_idle: z.boolean().default(true),
  beads_command: z.string().default("bd"),
})

export type BeadsConfig = z.infer<typeof BeadsConfigSchema>
