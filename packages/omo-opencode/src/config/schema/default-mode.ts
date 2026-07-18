import { z } from "zod"

export const DefaultModeConfigSchema = z.object({
  /**
   * Automatically inject ultrawork mode prompt on main session start
   * without requiring "ultrawork"/"ulw" keyword in the message.
   * The ultrawork mode system prompt is injected once per session.
   */
  ultrawork: z.boolean().default(false),
 /**
 * Automatically create a goal from the first main-session message
 * without requiring the /goal command.
 */
 goal: z.boolean().default(false),
})

export type DefaultModeConfig = z.infer<typeof DefaultModeConfigSchema>
