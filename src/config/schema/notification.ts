import { z } from "zod"

export const NotificationConfigSchema = z.object({
  /** Force enable session-notification even if external notification plugins are detected (default: false) */
  force_enable: z.boolean().optional(),
  /** Custom notification script path (compatible with Claude Code hooks) */
  script: z.string().optional(),
  /** Play sound on notification (default: false) */
  playSound: z.boolean().optional(),
  /** Path to sound file */
  soundPath: z.string().optional(),
})

export type NotificationConfig = z.infer<typeof NotificationConfigSchema>
