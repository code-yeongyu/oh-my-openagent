import * as z from "zod"

import { OmoReasoningEffortSchema } from "./fallback-models"

/**
 * An agent model chain entry. A bare string keeps every existing config parsing unchanged; the
 * object form adds the per-entry tuning an agent can actually apply. This is deliberately NARROWER
 * than a category `fallback_models` entry: agent resolution only threads `variant` and
 * `reasoningEffort` to the child, so accepting `temperature` / `maxTokens` / `thinking` here would
 * advertise fields that are silently dropped.
 */
export const OmoAgentModelEntrySchema = z.union([
  z.string(),
  z.object({
    model: z.string(),
    variant: z.string().optional(),
    reasoningEffort: OmoReasoningEffortSchema.optional(),
  }).strict(),
])

export const OmoAgentDefSchema = z.object({
  description: z.string().optional(),
  prompt: z.string().optional(),
  model: z.string().optional(),
  models: z.array(OmoAgentModelEntrySchema).optional(),
  variant: z.string().optional(),
  reasoningEffort: OmoReasoningEffortSchema.optional(),
  tools: z.record(z.string(), z.boolean()).optional(),
  execution_mode: z.enum(["in-process", "process"]).optional(),
  background: z.boolean().optional(),
  max_depth: z.number().int().nonnegative().optional(),
  allowed_subagents: z.array(z.string()).optional(),
  temperature: z.number().min(0).max(2).optional(),
  disable: z.boolean().optional(),
}).strict()

export const OmoAgentsConfigSchema = z.record(z.string(), OmoAgentDefSchema)

export type OmoAgentModelEntry = z.infer<typeof OmoAgentModelEntrySchema>
export type OmoAgentDef = z.infer<typeof OmoAgentDefSchema>
export type OmoAgentsConfig = z.infer<typeof OmoAgentsConfigSchema>
