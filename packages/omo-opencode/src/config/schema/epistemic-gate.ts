import { z } from "zod"

export const EpistemicGateModeSchema = z.enum(["annotation", "gate", "hybrid", "dominance"]).default("annotation")

export const PreferenceWeightsSchema = z
  .object({
    logico: z.number().min(0).max(1).default(0.6),
    probabilistico: z.number().min(0).max(1).default(0.4),
    etico: z.number().min(0).max(1).default(0),
    pragmatico: z.number().min(0).max(1).default(0),
    morale: z.number().min(0).max(1).default(0),
  })
  .refine((data) => Math.abs(data.logico + data.probabilistico + data.etico + data.pragmatico + data.morale - 1.0) < 0.001, {
    message: "preference_weights must sum to 1.0",
  })

export type EpistemicGateMode = z.infer<typeof EpistemicGateModeSchema>
export type PreferenceWeights = z.infer<typeof PreferenceWeightsSchema>
