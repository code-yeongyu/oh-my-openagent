import { z } from "zod"

export const NotificationConfigSchema = z.object({
  /** Force enable session-notification even if external notification plugins are detected (default: false) */
  force_enable: z.boolean().optional(),
})

export type NotificationConfig = z.infer<typeof NotificationConfigSchema>
