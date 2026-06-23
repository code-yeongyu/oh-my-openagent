import { z } from "zod"

export const PremiseSchema = z.object({
  formula: z.string().min(1),
  kind: z.enum(["axiom", "ordinary", "assumption"]).optional().default("ordinary"),
})

export type PremiseKind = z.infer<typeof PremiseSchema>["kind"]

export const RuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  antecedents: z.array(z.string()),
  consequent: z.string().min(1),
})

export const PreferenceSchema = z.object({
  superior: z.string().min(1),
  inferior: z.string().min(1),
})

export const PreferenceGroupSchema = z.object({
  group_id: z.string(),
  ordered_rules: z.array(z.string()),
  relation_to_other_groups: z.enum(["unordered", "superior", "inferior"]).optional().default("unordered"),
})

export const TheorySchema = z.object({
  premises: z.array(PremiseSchema).min(1),
  strict_rules: z.array(RuleSchema).optional(),
  defeasible_rules: z.array(RuleSchema).optional(),
  contraries: z.array(z.tuple([z.string(), z.string()])).optional(),
  preferences: z
    .union([
      z.array(PreferenceSchema),
      z.object({
        pairwise: z.array(PreferenceSchema).optional(),
        groups: z.array(PreferenceGroupSchema).optional(),
      }),
    ])
    .optional(),
  /**
   * MUST be `true`. Classical negation is required by ASPIC+ semantics
   * as consumed by reasoning-core. Passing `false` produces silent wrong
   * policy verdicts (the engine does not error). Omitting the field is
   * accepted for one minor release as a migration shim and defaults to
   * `true`. See `docs/reference/reasoning-core.md`.
   */
  classical_negation: z
    .boolean()
    .optional()
    .default(true)
    .refine((v) => v !== false, {
      message: "classical_negation must be true per ASPIC+ contract",
    }),
})

export const FormalizationRequestSchema = z.object({
  problem_statement: z.string().min(1),
  options: z.array(z.string()).min(2),
  constraints: z.array(z.string()).default([]),
  preferences: z.array(z.object({ superior: z.string(), inferior: z.string() })).default([]),
  context: z.string().optional(),
  requested_semantics: z.enum(["grounded", "preferred", "stable", "complete"]).default("preferred"),
})

export const FormalizationProvenanceSchema = z.object({
  model_id: z.string(),
  model_version: z.string().optional(),
  prompt_version: z.string(),
  schema_version: z.number(),
  mode: z.enum(["permissive", "strict"]),
  cache_hit: z.boolean(),
  iterations_attempted: z.number(),
  derived_theory: TheorySchema.optional(),
})

export const FormalizationEnvelopeOkSchema = z.object({
  status: z.literal("ok"),
  theory: TheorySchema,
  diagnostics: z.object({
    premise_count: z.number(),
    strict_rule_count: z.number(),
    defeasible_rule_count: z.number(),
    preference_count: z.number(),
  }).optional(),
})

export const FormalizationEnvelopeErrorSchema = z.object({
  status: z.literal("error"),
  error_code: z.enum(["invalid_json", "schema_mismatch", "missing_theory", "malformed_theory"]),
  message: z.string(),
  recoverable: z.boolean(),
})

export const FormalizationEnvelopeSchema = z.discriminatedUnion("status", [
  FormalizationEnvelopeOkSchema,
  FormalizationEnvelopeErrorSchema,
])

export const FormalizationResultSchema = z.object({
  theory: TheorySchema,
  provenance: FormalizationProvenanceSchema,
})
