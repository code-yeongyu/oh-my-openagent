import { z } from "zod"

export const ContinuationConfigSchema = z.object({
  /** Base cooldown between continuation injections in ms (default: 5000, minimum: 1000) */
  cooldownMs: z.number().min(1000).optional(),
  /** Grace period after abort detection in ms (default: 3000, minimum: 500) */
  abortWindowMs: z.number().min(500).optional(),
  /** Max consecutive injections without todo progress before stopping (default: 3, minimum: 1) */
  maxStagnationCount: z.number().int().min(1).optional(),
  /** Max injection failures before entering pause period (default: 5, minimum: 1) */
  maxConsecutiveFailures: z.number().int().min(1).optional(),
  /** Window in ms before consecutive failure count resets (default: 300000, minimum: 30000) */
  failureResetWindowMs: z.number().min(30000).optional(),
  /** Countdown toast duration in seconds (default: 2, minimum: 1) */
  countdownSeconds: z.number().int().min(1).optional(),
})

export type ContinuationConfig = z.infer<typeof ContinuationConfigSchema>
