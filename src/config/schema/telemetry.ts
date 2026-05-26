import { z } from "zod"

export const TelemetryConfigSchema = z.object({
  /**
   * Enable anonymous telemetry (default: true).
   * Set to false to disable PostHog analytics.
   * Equivalent to setting OMO_SEND_ANONYMOUS_TELEMETRY=0 or OMO_DISABLE_POSTHOG=1.
   */
  enabled: z.boolean().optional(),
})

export type TelemetryConfig = z.infer<typeof TelemetryConfigSchema>
