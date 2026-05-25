import { z } from "zod"

export const DefaultModeConfigSchema = z.object({
  /**
   * Automatically inject ultrawork mode prompt on main session start
   * without requiring "ultrawork"/"ulw" keyword in the message.
   * The ultrawork mode system prompt is injected once per session.
   */
  ultrawork: z.boolean().default(false),
  /**
   * Automatically start ralph loop on main session start
   * without requiring /ralph-loop or /ulw-loop commands.
   * When ultrawork is also enabled, the loop starts in ultrawork mode.
   */
  ralph_loop: z.boolean().default(false),
})

export type DefaultModeConfig = z.infer<typeof DefaultModeConfigSchema>
