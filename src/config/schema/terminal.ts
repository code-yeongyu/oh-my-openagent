import { z } from "zod"
import { TmuxConfigSchema } from "./tmux"

export const ZellijConfigSchema = z.object({
  enabled: z.boolean().default(false),
  session_prefix: z.string().optional(),
})

export const TerminalConfigSchema = z.object({
  provider: z.enum(["auto", "tmux", "zellij"]).default("auto"),
  tmux: TmuxConfigSchema.optional(),
  zellij: ZellijConfigSchema.optional(),
})

export type ZellijConfig = z.infer<typeof ZellijConfigSchema>
export type TerminalConfig = z.infer<typeof TerminalConfigSchema>
