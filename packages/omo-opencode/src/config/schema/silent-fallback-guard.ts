import { z } from "zod"

export const SilentFallbackGuardConfigSchema = z.object({
  /** Enable the silent fallback guard (default: false). */
  enabled: z.boolean().optional(),
  /** Intervention mode: report writes a file, pushback injects a reviewer prompt (default: report). */
  mode: z.enum(["report", "pushback"]).optional(),
  /** Maximum candidates to review in one turn. */
  max_review_candidates: z.number().int().min(1).optional(),
  /** Maximum candidates per file in one turn. */
  max_per_file: z.number().int().min(1).optional(),
  /** Maximum candidates per risk type in one turn. */
  max_per_risk_type: z.number().int().min(1).optional(),
  /** Include low-confidence candidates in review (default: false). */
  include_low_confidence: z.boolean().optional(),
  /** Supported language identifiers for detection. */
  supported_languages: z.array(z.string()).optional(),
})

export type SilentFallbackGuardConfigInput = z.infer<typeof SilentFallbackGuardConfigSchema>
