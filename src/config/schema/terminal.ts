import { z } from "zod"

export const ZellijConfigSchema = z.object({
  enabled: z.boolean().default(true),
})

export const TerminalConfigSchema = z.object({
  provider: z.enum(["auto", "tmux", "zellij"]).default("auto"),
  zellij: ZellijConfigSchema.optional(),
})

export type ZellijConfig = z.infer<typeof ZellijConfigSchema>
export type TerminalConfig = z.infer<typeof TerminalConfigSchema>
