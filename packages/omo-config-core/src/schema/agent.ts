import * as z from "zod"

import {
  OmoFallbackModelObjectSchema,
  OmoFallbackModelsSchema,
  OmoReasoningEffortSchema,
  normalizeLegacyModelFields,
} from "./fallback-models"
import { OmoReasoningSchema } from "./model-ref"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export const OmoAgentModelEntrySchema = z.union([z.string(), OmoFallbackModelObjectSchema])

const PermissionValueSchema = z.enum(["ask", "allow", "deny"])

const BashPermissionSchema = z.union([
  PermissionValueSchema,
  z.record(z.string(), PermissionValueSchema),
])

export const OmoAgentPermissionSchema = z.object({
  edit: PermissionValueSchema.optional(),
  bash: BashPermissionSchema.optional(),
  webfetch: PermissionValueSchema.optional(),
  task: PermissionValueSchema.optional(),
  doom_loop: PermissionValueSchema.optional(),
  external_directory: PermissionValueSchema.optional(),
}).catchall(PermissionValueSchema.optional())

export type OmoAgentPermission = z.infer<typeof OmoAgentPermissionSchema>

const OmoAgentDefInputSchema = z.object({
  description: z.string().optional(),
  prompt: z.string().optional(),
  model: z.string().optional(),
  models: z.array(OmoAgentModelEntrySchema).optional(),
  models_distribution: z.enum(["sequential", "round_robin"]).optional(),
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
  permission: OmoAgentPermissionSchema.optional(),
  prompt_append: z.string().optional(),
  // Keys documented in docs/reference/configuration.md (per-agent table) and accepted by the
  // OpenCode adapter's AgentOverrideConfigSchema. Drift guard: core-schema-parity.test.ts.
  fallback_models: OmoFallbackModelsSchema.optional(),
  category: z.string().optional(),
  skills: z.array(z.string()).optional(),
  top_p: z.number().min(0).max(1).optional(),
  mode: z.enum(["subagent", "primary", "all"]).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  displayName: z.string().optional(),
  // Canonical forms of the documented `maxTokens`, `providerOptions`, `thinking`, `textVerbosity`:
  // normalizeLegacyModelFields folds those camelCase inputs into these two keys before parsing.
  max_tokens: z.number().int().positive().optional(),
  provider_options: z.record(z.string(), z.unknown()).optional(),
  /** Per-message ultrawork model/reasoning override. */
  ultrawork: z.object({
    model: z.string().optional(),
    reasoning: OmoReasoningSchema.optional(),
    /** @deprecated Use reasoning. */
    variant: z.string().optional(),
  }).optional(),
  /** Compaction model/reasoning override. */
  compaction: z.object({
    model: z.string().optional(),
    reasoning: OmoReasoningSchema.optional(),
    /** @deprecated Use reasoning. */
    variant: z.string().optional(),
  }).optional(),
  /** Hephaestus-specific in the adapter; a shared file may carry it for any agent. */
  allow_non_gpt_model: z.boolean().optional(),
}).strict()

export const OmoAgentDefSchema = z.preprocess(
  (value) => isRecord(value) ? normalizeLegacyModelFields(value) : value,
  OmoAgentDefInputSchema,
)

export const OmoAgentsConfigSchema = z.record(z.string(), OmoAgentDefSchema)

export type OmoAgentModelEntry = z.infer<typeof OmoAgentModelEntrySchema>
export type OmoAgentDef = z.infer<typeof OmoAgentDefSchema>
export type OmoAgentsConfig = z.infer<typeof OmoAgentsConfigSchema>
