import { z } from "zod"

export const ContinuationConfigSchema = z.object({
  cooldownMs: z.number().min(1000).optional(),
  abortWindowMs: z.number().min(500).optional(),
  maxStagnationCount: z.number().int().min(1).optional(),
  maxConsecutiveFailures: z.number().int().min(1).optional(),
  failureResetWindowMs: z.number().min(30000).optional(),
  countdownSeconds: z.number().int().min(1).optional(),
})

export type ContinuationConfig = z.infer<typeof ContinuationConfigSchema>
