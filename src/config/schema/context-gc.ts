import { z } from "zod"

export const ContextGcConfigSchema = z.object({
  /** Turns to keep fully intact (default: 3) */
  hot_turns: z.number().min(1).optional(),
  /** Turns before tool outputs are compressed (default: 10) */
  warm_turns: z.number().min(1).optional(),
  /** Turns before messages are replaced with brain references (default: 25) */
  cold_turns: z.number().min(1).optional(),
  /** Turns before messages are removed entirely (default: 40) */
  gone_turns: z.number().min(1).optional(),
  /** Minimum hot turns to always preserve (default: 3) */
  min_hot_turns: z.number().min(1).optional(),
  /** Max messages to remove per GC cycle (default: 5) */
  max_gone_per_cycle: z.number().min(1).optional(),
  /** Token usage % to trigger GC (default: 60) */
  gc_trigger_pct: z.number().min(1).max(99).optional(),
  /** Token usage % target after GC (default: 40) */
  gc_target_pct: z.number().min(1).max(99).optional(),
  /** Minimum ms between GC cycles (default: 30000) */
  gc_cooldown_ms: z.number().min(0).optional(),
  /** Write large tool outputs to brain asynchronously (default: false) */
  brain_write_through: z.boolean().optional(),
})

export type ContextGcConfig = z.infer<typeof ContextGcConfigSchema>
