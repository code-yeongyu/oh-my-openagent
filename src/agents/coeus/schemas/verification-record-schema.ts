import { z } from 'zod'

export const BoundaryVerificationSchema = z.object({
  boundary: z.string().min(1),
  query: z.string(),
  matched_entry: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  tier: z
    .enum([
      'tier-1-ground-truth',
      'tier-2-validated-reference',
      'tier-3-battle-tested',
      'tier-4-community',
    ])
    .optional(),
  status: z.enum(['verified', 'unverified', 'novel']),
  rabbit_hole: z.string().optional(),
})

export const VerificationRecordSchema = z.object({
  slug: z.string(),
  created: z.string(),
  domains: z.array(z.string()).min(1),
  boundaries: z.array(BoundaryVerificationSchema),
  verified_count: z.number(),
  unverified_count: z.number(),
  novel_count: z.number(),
})

export type BoundaryVerification = z.infer<typeof BoundaryVerificationSchema>
export type VerificationRecord = z.infer<typeof VerificationRecordSchema>
