import { z } from "zod"

export const NotificationConfigSchema = z.object({
  /** Force enable session-notification even if external notification plugins are detected (default: false) */
  force_enable: z.boolean().optional(),
  /** Play a sound when a session notification is sent (default: false) */
  play_sound: z.boolean().optional(),
  /** Path to a custom sound file to play with notifications (uses OS default if omitted) */
  sound_path: z.string().optional(),
})

export type NotificationConfig = z.infer<typeof NotificationConfigSchema>
