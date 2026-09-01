import * as z from "zod"

import {
  OmoFallbackModelObjectSchema,
  OmoReasoningEffortSchema,
  normalizeLegacyModelFields,
} from "./fallback-models"
import { OmoReasoningSchema } from "./model-ref"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export const OmoAgentModelEntrySchema = z.union([z.string(), OmoFallbackModelObjectSchema])

const OmoAgentDefInputSchema = z.object({
  description: z.string().optional(),
  prompt: z.string().optional(),
  model: z.string().optional(),
  models: z.array(OmoAgentModelEntrySchema).optional(),
  reasoning: OmoReasoningSchema.optional(),
  /** @deprecated Use reasoning. */
  variant: z.string().optional(),
  /** @deprecated Use reasoning. */
  reasoningEffort: OmoReasoningEffortSchema.optional(),
  tools: z.record(z.string(), z.boolean()).optional(),
  execution_mode: z.enum(["in-process", "process"]).optional(),
  background: z.boolean().optional(),
  max_depth: z.number().int().nonnegative().optional(),
  allowed_subagents: z.array(z.string()).optional(),
  disallowed_tools: z.array(z.string()).optional(),
  max_turns: z.number().int().nonnegative().optional(),
  temperature: z.number().min(0).max(2).optional(),
  disable: z.boolean().optional(),
}).strict()

export const OmoAgentDefSchema = z.preprocess(
  (value) => isRecord(value) ? normalizeLegacyModelFields(value) : value,
  OmoAgentDefInputSchema,
)

export const OmoAgentsConfigSchema = z.record(z.string(), OmoAgentDefSchema)

export type OmoAgentModelEntry = z.infer<typeof OmoAgentModelEntrySchema>
export type OmoAgentDef = z.infer<typeof OmoAgentDefSchema>
export type OmoAgentsConfig = z.infer<typeof OmoAgentsConfigSchema>
