import { z } from "zod"

export const ConfidenceWeightsSchema = z
  .object({
    extensionRatio: z.number().min(0).max(1).default(0.4),
    proofChainDepth: z.number().min(0).max(1).default(0.3),
    ruleStrength: z.number().min(0).max(1).default(0.3),
  })
  .refine(
    (data) => Math.abs(data.extensionRatio + data.proofChainDepth + data.ruleStrength - 1.0) < 0.001,
    { message: "confidence_weights must sum to 1.0" },
  )

export const DominanceThresholdSchema = z.number().min(0).max(1).default(0.7)

export const InconclusiveThresholdsSchema = z.object({
  confidence_min: z.number().min(0).max(1).default(0.7),
  dominance_margin_min: z.number().min(0).max(1).default(0.1),
})

export type ConfidenceWeights = z.infer<typeof ConfidenceWeightsSchema>
export type InconclusiveThresholds = z.infer<typeof InconclusiveThresholdsSchema>
