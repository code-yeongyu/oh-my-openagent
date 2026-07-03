import { z } from "zod"

export const RuntimeFallbackConfigSchema = z.object({
  /** Enable runtime fallback (default: false) */
  enabled: z.boolean().optional(),
  /** HTTP status codes that trigger fallback (default: [429, 500, 502, 503, 504]) */
  retry_on_errors: z.array(z.number()).optional(),
  /** Maximum fallback attempts per session (default: 3) */
  max_fallback_attempts: z.number().min(1).max(20).optional(),
  /** Cooldown in seconds before retrying a failed model (default: 60) */
  cooldown_seconds: z.number().min(0).optional(),
  /** Session-level timeout in seconds to advance fallback when provider hangs (default: 30). Set to 0 to disable timeout escalation and message.updated auto-retry signal detection. */
  timeout_seconds: z.number().min(0).optional(),
  /** Reserved-session retry attempts after promptAsync reports an active reservation (default: 6). Increase for providers with long internal retry reservations. */
  reserved_retry_attempts: z.number().int().min(0).max(60).optional(),
  /** Base delay in milliseconds for reserved-session linear backoff (default: 500). Delay is base * attempt number. */
  reserved_retry_base_delay_ms: z.number().int().min(0).max(60_000).optional(),
  /** Show toast notification when switching to fallback model (default: true) */
  notify_on_fallback: z.boolean().optional(),
  restore_primary_after_cooldown: z.boolean().optional(),
})

export type RuntimeFallbackConfig = z.infer<typeof RuntimeFallbackConfigSchema>
