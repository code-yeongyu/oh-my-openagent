import * as z from "zod"

export const AtomicTriageReviewSchema = z.object({
  reference: z.string(),
  verdict: z.string(),
  inputs: z.object({
    feature: z.string(),
    target: z.string(),
    view_merkle: z.string(),
    candidate_changes: z.array(z.string()),
    closure_additions: z.array(z.string()),
    intent_substance_hashes: z.record(z.string(), z.unknown()),
  }),
  summary: z.object({
    changes: z.number(),
    files: z.number(),
    criteria_met: z.number(),
    criteria_unmet: z.number(),
    findings_block: z.number(),
    findings_warn: z.number(),
    findings_info: z.number(),
  }),
  intents: z.array(z.record(z.string(), z.unknown())),
  changes: z.array(z.looseObject({ id: z.string(), message: z.string() })),
  findings: z.array(
    z.object({
      code: z.string(),
      severity: z.enum(["block", "warn", "info"]),
      focus: z.string(),
      message: z.string(),
      suggested_query: z.string().optional(),
      remedy: z.string(),
    }),
  ),
  walkthrough: z.array(z.record(z.string(), z.unknown())),
})

export type AtomicTriageReview = z.infer<typeof AtomicTriageReviewSchema>
