import type { z } from "zod"
import {
  FormalizationEnvelopeSchema,
  FormalizationProvenanceSchema,
  FormalizationRequestSchema,
  FormalizationResultSchema,
  TheorySchema,
} from "./schemas"
import type { FormalizationErrorCode } from "./errors"

export type Theory = z.infer<typeof TheorySchema>
export type FormalizationRequest = z.infer<typeof FormalizationRequestSchema>
export type FormalizationEnvelope = z.infer<typeof FormalizationEnvelopeSchema>
export type FormalizationResult = z.infer<typeof FormalizationResultSchema>
export type FormalizationProvenance = z.infer<typeof FormalizationProvenanceSchema>
export type { FormalizationErrorCode }
