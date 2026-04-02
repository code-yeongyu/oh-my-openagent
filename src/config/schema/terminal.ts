import { z } from "zod"

export const TerminalMultiplexerConfigSchema = z.object({
  provider: z.enum(["auto", "tmux", "zellij"]).default("auto"),
})

export type TerminalMultiplexerConfig = z.infer<typeof TerminalMultiplexerConfigSchema>
